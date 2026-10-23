// The `voice.process` job body (#542): transcribe a recording, structure the transcript and stage
// what it says as proposals. Order matters: the `ai_blocked` flag (a sensitive matter) is read
// first, so a blocked capture never has its audio read or sent anywhere and stays L1 with a
// reason. Audio that is too short, silent or low-confidence is never structured: the capture goes
// to Needs you with its audio kept and no drafts. The transcript is stored with its segment spans
// and language tags; the raw audio keeps its 30-day clock (`ttl_at`, set at creation) and the
// transcript and proposals outlive it. Nothing is auto-applied here: the engine's matrix decides.
import { can, isRole } from '@causedeck/auth/policy';
import {
  CAPTURE_PIPELINE_VERSION,
  VOICE_MIN_DURATION_SECONDS,
  isUnreadableAudio,
} from '@causedeck/capture';
import { serverEnv } from '@causedeck/config/env';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import type { AiGateway } from '@causedeck/ai';
import {
  createGatewayTranscribe,
  hearingToProposalDrafts,
  languageHints,
  rankMatters,
  structureHearing,
  type IntelligenceEvents,
  type MatterCandidate,
  type TranscribePort,
} from '@causedeck/intelligence';
import { createObjectStoreFromEnv, type ObjectKey, type ObjectStore } from '@causedeck/storage';
import { and, eq, isNull } from 'drizzle-orm';

import { createCoreAiGateway } from '../ai/index.ts';
import { submitProposals } from '../automation/index.ts';
import { finishCapture } from '../capture/index.ts';
import type { GraphEvents, MatterGraphDeps } from '../matter-graph/index.ts';
import { forbidden } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import { citedSpans, spanKey, storeTranscript } from './transcript.ts';

const { capture, forum, matter, proceeding, user } = schema;

const NO_GRAPH_EVENTS: GraphEvents = {
  emit() {
    // The voice job has no graph event subscribers.
  },
};

export interface VoiceProcessDeps {
  db: Database | Transaction;
  store?: ObjectStore;
  /** Defaults to the core gateway over the transaction (mock provider unless configured). */
  gateway?: AiGateway;
  /** Defaults to the gateway-backed `transcribe` task; tests pass the sidecar port. */
  transcriber?: TranscribePort;
  events?: IntelligenceEvents;
  now?: () => Date;
}

export type VoiceProcessOutcome =
  | { outcome: 'missing' }
  | { outcome: 'skipped' }
  | { outcome: 'failed' }
  /** `ai_blocked`: the audio was not read; the capture is `ready` at L1 with a reason. */
  | { outcome: 'blocked' }
  | { outcome: 'unreadable' }
  | { outcome: 'unmatched' }
  | { outcome: 'structured'; proposals: number; needsYou: boolean };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in India for an instant: the hearing date of a note recorded today. */
function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const metaString = (meta: Record<string, unknown>, key: string): string | undefined => {
  const value = meta[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** The workspace's matters as match candidates: case numbers of proceedings, party names. */
async function loadCandidates(tx: Transaction, workspaceId: string): Promise<MatterCandidate[]> {
  const matters = await tx
    .select({ id: matter.id, title: matter.title })
    .from(matter)
    .where(
      and(
        eq(matter.workspaceId, workspaceId),
        eq(matter.sensitive, false),
        isNull(matter.mergedIntoMatterId),
      ),
    );
  const proceedings = await tx
    .select({
      id: proceeding.id,
      matterId: proceeding.matterId,
      type: proceeding.caseTypeRaw,
      code: proceeding.caseTypeCode,
      number: proceeding.number,
      year: proceeding.year,
      petitioner: proceeding.titlePetitioner,
      respondent: proceeding.titleRespondent,
    })
    .from(proceeding)
    .where(eq(proceeding.workspaceId, workspaceId));
  return matters.flatMap((m): MatterCandidate[] => {
    const own = proceedings.filter((p) => p.matterId === m.id);
    const parties = [m.title, ...own.flatMap((p) => [p.petitioner, p.respondent])].filter(
      (name): name is string => name !== null && name !== '',
    );
    const single = own.length === 1 ? own[0] : undefined;
    const numbered = own.filter((p) => p.number !== null && p.year !== null);
    const caseNumbers = numbered.map(
      (p) => `${p.type ?? p.code} No. ${p.number ?? ''} of ${String(p.year)}`,
    );
    return [
      {
        matterId: m.id,
        ...(single === undefined ? {} : { proceedingId: single.id }),
        caseNumbers,
        parties,
      },
    ];
  });
}

/** The speaker's languages (profile locale) then the forum's speech languages of the matter. */
async function hintsFor(
  tx: Transaction,
  workspaceId: string,
  userId: string,
  matterId: string | null,
): Promise<ReturnType<typeof languageHints>> {
  const [profile] = await tx.select({ locale: user.locale }).from(user).where(eq(user.id, userId));
  const forumLanguages: string[] = [];
  if (matterId !== null) {
    const rows = await tx
      .select({ profile: forum.languageProfile })
      .from(proceeding)
      .innerJoin(forum, eq(forum.id, proceeding.forumId))
      .where(and(eq(proceeding.workspaceId, workspaceId), eq(proceeding.matterId, matterId)));
    for (const { profile: p } of rows) {
      forumLanguages.push(...(p.stt ?? []), ...(p.primary === undefined ? [] : [p.primary]));
    }
  }
  return languageHints(profile === undefined ? [] : [profile.locale], forumLanguages);
}

export async function runVoiceProcess(
  deps: VoiceProcessDeps,
  payload: { workspaceId: string; captureId: string },
): Promise<VoiceProcessOutcome> {
  const { workspaceId, captureId } = payload;
  const now = deps.now?.() ?? new Date();
  const pending: Parameters<IntelligenceEvents['emit']>[0][] = [];
  const result = await withWorkspace(
    deps.db,
    { workspaceId },
    async (tx): Promise<VoiceProcessOutcome> => {
      const [row] = await tx
        .select()
        .from(capture)
        .where(and(eq(capture.id, captureId), eq(capture.workspaceId, workspaceId)))
        .for('update');
      if (row === undefined) return { outcome: 'missing' };
      if (row.status !== 'processing' || row.channel !== 'voice') return { outcome: 'skipped' };

      // The one gate in front of the audio: a sensitive-matter capture is never read or sent.
      if (row.aiBlocked) {
        await finishCapture(
          tx,
          row,
          'ready',
          { voice: { structured: false, reason: 'ai_blocked' } },
          now,
        );
        return { outcome: 'blocked' };
      }
      const userId = row.createdBy;
      const key = row.rawStorageKey;
      if (userId === null || key === null) {
        await finishCapture(tx, row, 'failed', {}, now, 'processing_failed');
        return { outcome: 'failed' };
      }
      const role = await memberRole(tx, userId, workspaceId);
      if (role === null || !isRole(role)) throw forbidden('The recorder is no longer a member');
      const actor = { userId, workspaceId, role };
      if (!can(actor, 'matter.write').allow) throw forbidden('You cannot capture a recording');

      const unreadable = async (durationSeconds: number | null) => {
        await finishCapture(
          tx,
          row,
          'needs_you',
          {
            needsYouReason: 'voice_unreadable',
            voice: { structured: false, reason: 'unreadable', durationSeconds },
          },
          now,
        );
        return { outcome: 'unreadable' } as const;
      };

      const declared = Number(row.sourceMeta['durationSeconds']);
      const knownDuration = Number.isFinite(declared) ? declared : null;
      // Too short to read: decided before the audio is fetched or sent.
      if (knownDuration !== null && knownDuration < VOICE_MIN_DURATION_SECONDS) {
        return unreadable(knownDuration);
      }

      const store = deps.store ?? createObjectStoreFromEnv(serverEnv());
      const object = await store.get(key as ObjectKey);
      const gateway = deps.gateway ?? createCoreAiGateway(tx, { now: () => now });
      const scope = {
        workspaceId,
        userId,
        captureId,
        ...(row.matterHintId === null ? {} : { matterId: row.matterHintId }),
      };
      const transcriber =
        deps.transcriber ??
        createGatewayTranscribe({ gateway, scope, pipelineVersion: CAPTURE_PIPELINE_VERSION });
      const hints = await hintsFor(tx, workspaceId, userId, row.matterHintId);
      const transcript = await transcriber.transcribe({
        audio: object.body,
        mimeType: row.mime,
        durationSeconds: knownDuration ?? 0,
        languageHints: hints,
      });
      const durationSeconds = knownDuration ?? (transcript.segments.at(-1)?.endMs ?? 0) / 1000;
      if (
        isUnreadableAudio({
          durationSeconds,
          text: transcript.text,
          confidence: transcript.confidence,
        })
      ) {
        return unreadable(durationSeconds);
      }

      const hearingDate = metaString(row.sourceMeta, 'hearingDate') ?? istDate(row.createdAt);
      const structured = await structureHearing({
        gateway,
        scope,
        pipelineVersion: CAPTURE_PIPELINE_VERSION,
      })({ transcript: transcript.text, hearingDate, languageHints: hints });

      const listingCase = metaString(row.sourceMeta, 'listingCaseNumber');
      const match = rankMatters(transcript.text, await loadCandidates(tx, workspaceId), {
        ...(row.matterHintId === null ? {} : { matterId: row.matterHintId }),
        ...(listingCase === undefined ? {} : { caseNumber: listingCase }),
      });
      const matterId = match.matched?.matterId ?? row.matterHintId;
      if (matterId === null) {
        // Nothing to hang the transcript on: the candidates go to the person, no drafts.
        await finishCapture(
          tx,
          row,
          'needs_you',
          {
            needsYouReason: 'voice_unmatched',
            voice: {
              structured: false,
              reason: 'unmatched',
              candidates: match.candidates.map((c) => c.matterId),
            },
          },
          now,
        );
        return { outcome: 'unmatched' };
      }

      const graph: MatterGraphDeps = {
        db: tx,
        events: NO_GRAPH_EVENTS,
        settings: toPolicySettings(await getRoleSettings(tx, workspaceId)),
        now: () => now,
      };
      const graphActor = { workspaceId, userId };
      const stored = await storeTranscript(
        { store, graph, now },
        tx,
        graphActor,
        matterId,
        transcript,
        citedSpans(structured.structured),
      );
      pending.push({
        type: 'capture.transcribed',
        workspaceId,
        captureId,
        documentId: stored.documentId,
        language: transcript.language,
        segments: transcript.segments.length,
      });

      const drafts = hearingToProposalDrafts({
        captureId,
        hearingDate,
        structured: structured.structured,
        match,
        confidence: structured.confidence,
        anchorFor: (span) => stored.anchors.get(spanKey(span)) ?? '',
      }).filter((draft) => draft.anchors.every((id) => id !== ''));
      const submitted =
        drafts.length === 0 ? { items: [] } : await submitProposals(graph, graphActor, drafts);
      const proposals = submitted.items.filter((i) => i.status !== 'refused').length;
      const needsYou =
        structured.needsYou !== null || (match.matched === null && match.candidates.length > 0);
      await finishCapture(
        tx,
        row,
        needsYou ? 'needs_you' : 'ready',
        {
          ...(structured.needsYou?.reasons.includes('next_date_dropped')
            ? { needsYouReason: 'voice_next_date_dropped' }
            : {}),
          voice: {
            structured: true,
            proposals,
            rejected: structured.rejected.length,
            transcriptDocumentId: stored.documentId,
            transcriptKey: stored.blobKey,
            durationSeconds,
          },
        },
        now,
      );
      pending.push({
        type: 'capture.structured',
        workspaceId,
        captureId,
        proposals,
        rejected: structured.rejected.length,
        needsYou,
      });
      return { outcome: 'structured', proposals, needsYou };
    },
  );
  // Events leave after the commit; a failed emit never undoes the capture.
  for (const event of pending) {
    try {
      await deps.events?.emit(event);
    } catch {
      // Best effort, as the pipeline's own events are.
    }
  }
  return result;
}
