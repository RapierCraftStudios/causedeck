// The `email.intake` job body (#54 part 3, #530). One received message goes through the parser
// registry of `@causedeck/capture` (`processIntake`): bounce and auto-reply mail is dropped; a
// sender that is not on the allow-list, or whose SPF/DKIM/DMARC failed, is quarantined with a
// Needs-you item and is never parsed (no parser, no AI); anything else is parsed, its captures are
// stored, its drafts are submitted to the automation engine (which decides the level) and the
// message is marked `processed`. Email text is data. Idempotent: only a `received` message is
// worked, so a retry or a second delivery of the job is a no-op. Captures that belong to a
// sensitive matter are `ai_blocked`, so no AI step ever runs on them (CA-10).
import {
  assertBytesMatch,
  assertWithinCap,
  CAPTURE_PIPELINE_VERSION,
  decideScan,
  forwardedTextTtl,
  isUnsupportedTypeError,
  processIntake,
  resolveAllowedType,
  transition,
  CaptureTooLargeError,
  type CaptureConfig,
  type CaptureProcessPayload,
  type CaptureStatus,
  type InboundEmailProvider,
  type IntakeCapture,
  type IntakeContext,
  type KnownMatter,
  type SenderPattern,
} from '@causedeck/capture';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { matchKey } from '@causedeck/adapters';
import { objectKey, type ObjectStore } from '@causedeck/storage';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import { record } from '../audit/index.ts';
import { submitProposals } from '../automation/index.ts';
import type { CaptureJobs } from '../capture/index.ts';
import type { GraphEvents, MatterGraphDeps } from '../matter-graph/index.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import { listAllowlist } from './allowlist.ts';

const { blob, capture, intakeMessage, matter, proceeding } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // The intake has no event subscribers.
  },
};

/** Known matters read per message; a workspace with more is matched on the first of them. */
const MATTER_LIMIT = 2000;
const BODY_FILE = 'email-body.txt';

export interface EmailIntakePayload {
  workspaceId: string;
  userId: string;
  intakeMessageId: string;
}

export interface EmailIntakeDeps {
  db: Database | Transaction;
  store: ObjectStore;
  /** Reads the raw message the webhook announced. */
  provider: Pick<InboundEmailProvider, 'fetchRaw'>;
  config: CaptureConfig;
  /** The capture producer port (`capture.scan`, `capture.process`); the domain never imports jobs. */
  jobs: CaptureJobs;
  events?: GraphEvents;
  now?: () => Date;
}

export type EmailIntakeOutcome =
  | { outcome: 'missing' }
  | { outcome: 'skipped' }
  | { outcome: 'dropped'; reason: string; rawExpiresAt: Date }
  | { outcome: 'quarantined'; reason: string; rawExpiresAt: Date }
  | {
      outcome: 'processed';
      parserId: string;
      captures: number;
      proposals: number;
      rawExpiresAt: Date;
    };

interface NewCapture {
  mime: string;
  filename: string;
  bytes: Uint8Array;
  aiBlocked: boolean;
  /** `queue`: through the scan and `capture.process`; `text`: finished here as `ready`/`needs_you`. */
  mode: 'queue' | 'text';
  needsYouReason?: string | undefined;
  sourceMeta: Record<string, unknown>;
}

interface Scope {
  tx: Transaction;
  deps: EmailIntakeDeps;
  workspaceId: string;
  userId: string;
  now: Date;
}

async function audit(
  scope: Scope,
  captureId: string,
  meta: Record<string, string | number | boolean>,
) {
  await record(
    {
      db: scope.tx,
      workspaceId: scope.workspaceId,
      actor: { userId: scope.userId, kind: 'user' },
    },
    { action: 'capture.created', target: { kind: 'capture', id: captureId }, metadata: meta },
  );
}

/** The state a new capture starts in, walked through the status machine from `received`. */
function stateFor(
  mode: 'queue' | 'text',
  to: CaptureStatus,
  sourceMeta: Record<string, unknown>,
  now: Date,
) {
  let state = { status: 'received' as CaptureStatus, sourceMeta };
  const path: CaptureStatus[] =
    mode === 'text' ? ['queued', 'processing', to] : to === 'scanning' ? ['scanning'] : ['queued'];
  for (const step of path) state = transition(state, step, now);
  return state;
}

/** Stores one capture's bytes and row; `skipped` says why a file was left out (never an error). */
async function storeCapture(
  scope: Scope,
  input: NewCapture,
): Promise<{ id: string; status: CaptureStatus } | { skipped: string }> {
  const { tx, deps, workspaceId, userId, now } = scope;
  let type: ReturnType<typeof resolveAllowedType>;
  try {
    type = resolveAllowedType(input.filename, input.mime);
    assertWithinCap(type, input.bytes.byteLength, deps.config.sizeCapsBytes);
    if (input.mode === 'queue') await assertBytesMatch(type, input.bytes);
  } catch (error) {
    if (isUnsupportedTypeError(error)) return { skipped: 'unsupported_type' };
    if (error instanceof CaptureTooLargeError) return { skipped: 'too_large' };
    throw error;
  }
  const bytes = Buffer.from(input.bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const [duplicate] = await tx
    .select({ id: capture.id })
    .from(capture)
    .where(
      and(
        eq(capture.workspaceId, workspaceId),
        eq(capture.sha256, sha256),
        eq(capture.channel, 'email'),
        isNotNull(capture.rawStorageKey),
        ne(capture.status, 'discarded'),
      ),
    )
    .limit(1);
  if (duplicate !== undefined) return { skipped: 'duplicate' };

  const scanning = input.mode === 'queue' && deps.config.scan.clamav !== null;
  if (input.mode === 'queue' && !scanning && !decideScan('skipped', deps.config.scan.required).ok) {
    return { skipped: 'scan_required' };
  }
  const to: CaptureStatus =
    input.mode === 'text'
      ? input.needsYouReason === undefined
        ? 'ready'
        : 'needs_you'
      : scanning
        ? 'scanning'
        : 'queued';
  const state = stateFor(
    input.mode,
    to,
    {
      ...input.sourceMeta,
      ...(input.needsYouReason === undefined ? {} : { needsYouReason: input.needsYouReason }),
      history: [],
    },
    now,
  );

  const blobId = randomUUID();
  const key = objectKey({ workspaceId, kind: type.kind, id: blobId }, now);
  await deps.store.put({ key, body: bytes, contentType: type.mime });
  try {
    await tx.insert(blob).values({
      id: blobId,
      workspaceId,
      key,
      kind: type.kind,
      filename: input.filename,
      size: bytes.byteLength,
      sha256,
      mime: type.mime,
      scanStatus: scanning ? 'pending' : 'skipped',
      createdBy: userId,
      createdAt: now,
      finalizedAt: now,
    });
    const [row] = await tx
      .insert(capture)
      .values({
        workspaceId,
        channel: 'email',
        status: state.status,
        rawStorageKey: key,
        sha256,
        mime: type.mime,
        sizeBytes: bytes.byteLength,
        originalFilename: input.filename,
        sourceMeta: state.sourceMeta,
        aiBlocked: input.aiBlocked,
        scanStatus: scanning ? 'pending' : 'skipped',
        ttlAt: input.mode === 'text' ? forwardedTextTtl(now) : null,
        processedAt: input.mode === 'text' ? now : null,
        createdBy: userId,
        createdAt: now,
      })
      .returning({ id: capture.id });
    if (row === undefined) throw new Error('capture insert returned no row');
    await audit(scope, row.id, {
      channel: 'email',
      mime: type.mime,
      sizeBytes: bytes.byteLength,
      aiBlocked: input.aiBlocked,
    });
    if (input.mode === 'queue') {
      if (scanning) await deps.jobs.scan({ workspaceId, captureId: row.id, sha256 });
      else {
        const payload: CaptureProcessPayload = {
          workspaceId,
          captureId: row.id,
          pipelineVersion: CAPTURE_PIPELINE_VERSION,
        };
        await deps.jobs.process(payload);
      }
    }
    return { id: row.id, status: state.status };
  } catch (error) {
    await deps.store.delete(key).catch(() => undefined);
    throw error;
  }
}

/** The quarantine "Unrecognised sender: review" item: an `email` capture waiting on the person. */
async function quarantineCapture(scope: Scope, messageId: string, reason: string): Promise<void> {
  const { tx, workspaceId, userId, now } = scope;
  const state = stateFor(
    'text',
    'needs_you',
    {
      needsYouReason: reason === 'auth_failed' ? 'sender_failed_checks' : 'unrecognised_sender',
      intakeMessageId: messageId,
      history: [],
    },
    now,
  );
  const [row] = await tx
    .insert(capture)
    .values({
      workspaceId,
      channel: 'email',
      status: state.status,
      rawStorageKey: null,
      mime: 'message/rfc822',
      sizeBytes: 0,
      sourceMeta: state.sourceMeta,
      aiBlocked: true,
      scanStatus: 'skipped',
      createdBy: userId,
      createdAt: now,
      processedAt: now,
    })
    .returning({ id: capture.id });
  if (row === undefined) throw new Error('capture insert returned no row');
  await audit(scope, row.id, {
    channel: 'email',
    mime: 'message/rfc822',
    sizeBytes: 0,
    aiBlocked: true,
  });
}

interface Known {
  matters: KnownMatter[];
  sensitiveMatterIds: Set<string>;
  sensitiveTokens: string[];
}

/** The workspace's proceedings as the parsers know them, and what marks a sensitive matter. */
async function loadKnown(tx: Transaction, workspaceId: string): Promise<Known> {
  const rows = await tx
    .select({
      matterId: proceeding.matterId,
      proceedingId: proceeding.id,
      cnr: proceeding.cnr,
      caseType: proceeding.caseTypeCode,
      number: proceeding.number,
      year: proceeding.year,
      sensitive: matter.sensitive,
    })
    .from(proceeding)
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
    )
    .where(eq(proceeding.workspaceId, workspaceId))
    .limit(MATTER_LIMIT);
  const known: Known = { matters: [], sensitiveMatterIds: new Set(), sensitiveTokens: [] };
  for (const row of rows) {
    const key = matchKey({ caseType: row.caseType, caseNumber: row.number, caseYear: row.year });
    known.matters.push({
      matterId: row.matterId,
      proceedingId: row.proceedingId,
      matchKey: key,
      cnr: row.cnr,
    });
    if (!row.sensitive) continue;
    known.sensitiveMatterIds.add(row.matterId);
    if (row.cnr) known.sensitiveTokens.push(row.cnr.toUpperCase());
    if (key !== null) known.sensitiveTokens.push(key.toUpperCase());
    if (row.number !== null && row.year !== null) {
      known.sensitiveTokens.push(`${row.caseType} ${row.number}/${String(row.year)}`.toUpperCase());
    }
  }
  return known;
}

function draftMatterIds(drafts: readonly { payload: unknown }[]): string[] {
  return drafts.flatMap((draft) => {
    const id = (draft.payload as { matterId?: unknown } | null)?.matterId;
    return typeof id === 'string' ? [id] : [];
  });
}

export async function runEmailIntake(
  deps: EmailIntakeDeps,
  payload: EmailIntakePayload,
): Promise<EmailIntakeOutcome> {
  const { workspaceId, userId, intakeMessageId } = payload;
  const now = deps.now?.() ?? new Date();

  return withWorkspace(
    deps.db,
    { workspaceId, userId },
    async (tx): Promise<EmailIntakeOutcome> => {
      const [message] = await tx
        .select()
        .from(intakeMessage)
        .where(
          and(eq(intakeMessage.id, intakeMessageId), eq(intakeMessage.workspaceId, workspaceId)),
        )
        .for('update');
      if (message === undefined) return { outcome: 'missing' };
      if (message.status !== 'received') return { outcome: 'skipped' };
      const rawExpiresAt = message.rawExpiresAt;
      const finish = async (status: 'dropped' | 'quarantined' | 'processed') => {
        await tx
          .update(intakeMessage)
          .set({ status })
          .where(
            and(eq(intakeMessage.id, intakeMessageId), eq(intakeMessage.workspaceId, workspaceId)),
          );
      };

      const role = await memberRole(tx, userId, workspaceId);
      if (role === null || message.rawMimeRef === null) {
        await finish('dropped');
        return {
          outcome: 'dropped',
          reason: role === null ? 'not_a_member' : 'raw_missing',
          rawExpiresAt,
        };
      }

      const raw = await deps.provider.fetchRaw(message.rawMimeRef);
      const allowList: SenderPattern[] = (await listAllowlist(tx, workspaceId)).map((entry) => ({
        pattern: entry.isDomain ? `@${entry.pattern}` : entry.pattern,
        kind: entry.kind,
      }));
      const known = await loadKnown(tx, workspaceId);
      const context: IntakeContext = {
        receivedAt: message.receivedAt.toISOString(),
        enrolmentNumbers: [],
        aliases: [],
        matters: known.matters,
      };
      const outcome = await processIntake(raw, { allowList, context });
      const scope: Scope = { tx, deps, workspaceId, userId, now };

      if (outcome.status === 'dropped') {
        await finish('dropped');
        return { outcome: 'dropped', reason: outcome.reason, rawExpiresAt };
      }
      if (outcome.status === 'quarantined') {
        await quarantineCapture(scope, intakeMessageId, outcome.verdict.reason);
        await finish('quarantined');
        return { outcome: 'quarantined', reason: outcome.verdict.reason, rawExpiresAt };
      }

      const { intake, result } = outcome;
      const text = `${intake.subject}\n${intake.body}`.toUpperCase();
      const aiBlocked =
        known.sensitiveTokens.some((token) => text.includes(token)) ||
        draftMatterIds(result.drafts).some((id) => known.sensitiveMatterIds.has(id));
      const needsYou = result.diagnostics.find((d) => d.severity === 'needs_you');

      const bodyCapture = result.captures.find((c) => c.source === 'body');
      const bytes = bodyCapture?.content ?? new TextEncoder().encode(intake.body);
      const body = await storeCapture(scope, {
        mime: 'text/plain',
        filename: BODY_FILE,
        bytes,
        aiBlocked,
        mode: 'text',
        needsYouReason: needsYou?.code,
        sourceMeta: { intakeMessageId, parserId: outcome.parserId, forwarded: intake.forwarded },
      });
      let stored = 'id' in body ? 1 : 0;
      const bodyId = 'id' in body ? body.id : undefined;
      for (const item of result.captures.filter(
        (c): c is IntakeCapture => c.source === 'attachment',
      )) {
        const done = await storeCapture(scope, {
          mime: item.mime,
          filename: item.fileName,
          bytes: item.content,
          aiBlocked,
          mode: 'queue',
          sourceMeta: { intakeMessageId, parserId: outcome.parserId },
        });
        if ('id' in done) stored += 1;
      }

      let proposals = 0;
      if (result.drafts.length > 0) {
        const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
        const graph: MatterGraphDeps = {
          db: tx,
          events: deps.events ?? NO_EVENTS,
          settings,
          now: () => now,
        };
        const drafts = result.drafts.map((draft) =>
          bodyId === undefined || draft.captureId !== undefined
            ? draft
            : { ...draft, captureId: bodyId },
        );
        const submitted = await submitProposals(graph, { workspaceId, userId }, drafts);
        proposals = submitted.items.filter((i) => i.status !== 'refused').length;
      }
      await finish('processed');
      return {
        outcome: 'processed',
        parserId: outcome.parserId,
        captures: stored,
        proposals,
        rawExpiresAt,
      };
    },
  );
}
