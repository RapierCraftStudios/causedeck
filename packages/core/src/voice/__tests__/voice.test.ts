// Voice capture (#542), against the real test database: a sensitive capture never has its audio
// read or sent, unreadable audio goes to Needs you with no drafts, a readable recording is
// transcribed and structured with the transcript stored with its spans, the 30-day sweep and the
// user's delete remove the audio while the transcript's document and the proposals stay.
import type { AiGateway } from '@causedeck/ai';
import { captureConfigFromEnv } from '@causedeck/capture';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  createEventLog,
  createSidecarTranscribe,
  type TranscribePort,
  type TranscriptSidecar,
} from '@causedeck/intelligence';
import { createMemoryObjectStore, objectKey, type ObjectKey } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { deleteRecording, sweepExpiredCaptures, type CaptureCtx } from '../../capture/index.ts';
import { runVoiceProcess } from '../index.ts';

const NOW = new Date('2026-10-19T10:00:00Z');
const AUDIO = new Uint8Array(Buffer.alloc(512, 1));

type Tx = Parameters<typeof newWorkspace>[0];

const SPEECH = 'Writ petition adjourned for counter. Next hearing on the fourteenth of November.';
const sidecar: TranscriptSidecar = {
  language: 'en',
  segments: [
    { startMs: 0, endMs: 3000, language: 'en', text: 'Writ petition adjourned for counter.' },
    {
      startMs: 3000,
      endMs: 7000,
      language: 'en',
      text: 'Next hearing on the fourteenth of November.',
    },
  ],
};

function hearingGateway() {
  const at = (needle: string) => {
    const start = SPEECH.indexOf(needle);
    return { start, end: start + needle.length };
  };
  const run = vi.fn((task: string) => {
    if (task !== 'structure_hearing') throw new Error(`unexpected task ${task}`);
    return Promise.resolve({
      callId: randomUUID(),
      output: {
        outcome: { text: 'adjourned for counter', span: at('adjourned for counter') },
        nextDate: {
          date: '2026-11-14',
          phrase: 'fourteenth of November',
          span: at('fourteenth of November'),
        },
        directions: [],
        tasks: [],
        confidence: 0.9,
      },
    });
  });
  return { gateway: { run } as unknown as AiGateway, run };
}

async function seed(
  tx: Tx,
  opts: { aiBlocked?: boolean; durationSeconds?: number; withMatter?: boolean } = {},
) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const store = createMemoryObjectStore();
  const [matter] =
    opts.withMatter === false
      ? []
      : await inWorkspace(tx, workspaceId, (s) =>
          s.insert(schema.matter).values({ workspaceId, title: 'Asha v State' }).returning(),
        );
  const key = objectKey({ workspaceId, kind: 'audio', id: randomUUID() }, NOW);
  await store.put({ key, body: AUDIO, contentType: 'audio/webm' });
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.capture)
      .values({
        workspaceId,
        channel: 'voice',
        status: 'processing',
        rawStorageKey: key,
        sha256: 'a'.repeat(64),
        mime: 'audio/webm',
        sizeBytes: AUDIO.byteLength,
        sourceMeta: { durationSeconds: opts.durationSeconds ?? 7 },
        matterHintId: matter?.id ?? null,
        aiBlocked: opts.aiBlocked ?? false,
        createdBy: ownerId,
        createdAt: NOW,
        ttlAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
      })
      .returning(),
  );
  if (row === undefined) throw new Error('capture not seeded');
  const ctx: CaptureCtx = {
    db: tx,
    store,
    workspaceId,
    userId: ownerId,
    authorize: () => undefined,
    config: captureConfigFromEnv({}),
    jobs: { scan: () => Promise.resolve(), process: () => Promise.resolve() },
    now: () => NOW,
  };
  return { workspaceId, ownerId, store, key, captureId: row.id, ctx };
}

async function readCapture(tx: Tx, workspaceId: string, captureId: string) {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s.select().from(schema.capture).where(eq(schema.capture.id, captureId)),
  );
  if (row === undefined) throw new Error('capture not found');
  return row;
}

describe('runVoiceProcess', () => {
  it('never reads or sends the audio of an ai_blocked capture and keeps it at L1 with a reason', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx, { aiBlocked: true });
      const get = vi.spyOn(s.store, 'get');
      const transcriber = createSidecarTranscribe(sidecar);
      const { gateway, run } = hearingGateway();
      const out = await runVoiceProcess(
        { db: tx, store: s.store, gateway, transcriber, now: () => NOW },
        { workspaceId: s.workspaceId, captureId: s.captureId },
      );
      expect(out).toEqual({ outcome: 'blocked' });
      expect(get).not.toHaveBeenCalled();
      expect(transcriber.calls).toHaveLength(0);
      expect(run).not.toHaveBeenCalled();
      const row = await readCapture(tx, s.workspaceId, s.captureId);
      expect(row.status).toBe('ready');
      expect(row.sourceMeta['voice']).toMatchObject({ structured: false, reason: 'ai_blocked' });
      expect(row.rawStorageKey).toBe(s.key);
    });
  });

  it('sends a recording under 2 s to Needs you without sending it anywhere', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx, { durationSeconds: 1.9 });
      const transcriber = createSidecarTranscribe(sidecar);
      const { gateway, run } = hearingGateway();
      const out = await runVoiceProcess(
        { db: tx, store: s.store, gateway, transcriber, now: () => NOW },
        { workspaceId: s.workspaceId, captureId: s.captureId },
      );
      expect(out).toEqual({ outcome: 'unreadable' });
      expect(transcriber.calls).toHaveLength(0);
      expect(run).not.toHaveBeenCalled();
      const row = await readCapture(tx, s.workspaceId, s.captureId);
      expect(row.status).toBe('needs_you');
      expect(row.sourceMeta['needsYouReason']).toBe('voice_unreadable');
      expect(row.rawStorageKey).toBe(s.key);
    });
  });

  it.each([
    ['silence', { text: '  ', confidence: 0.9 }],
    ['low confidence', { text: SPEECH, confidence: 0.1 }],
  ])('makes no guesses from %s: Needs you, audio kept, no drafts', async (_name, said) => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const transcriber: TranscribePort = {
        transcribe: () =>
          Promise.resolve({
            text: said.text,
            language: 'en',
            segments: [
              {
                startMs: 0,
                endMs: 7000,
                language: 'en',
                text: said.text,
                charStart: 0,
                charEnd: said.text.length,
              },
            ],
            confidence: said.confidence,
          }),
      };
      const { gateway, run } = hearingGateway();
      const out = await runVoiceProcess(
        { db: tx, store: s.store, gateway, transcriber, now: () => NOW },
        { workspaceId: s.workspaceId, captureId: s.captureId },
      );
      expect(out).toEqual({ outcome: 'unreadable' });
      expect(run).not.toHaveBeenCalled();
      const row = await readCapture(tx, s.workspaceId, s.captureId);
      expect(row.status).toBe('needs_you');
      expect(row.rawStorageKey).toBe(s.key);
      const proposals = await inWorkspace(tx, s.workspaceId, (q) =>
        q.select().from(schema.proposal),
      );
      expect(proposals).toHaveLength(0);
    });
  });

  it('transcribes, structures and stores the transcript with its spans and language, fast', async () => {
    await withTestDb(async (tx) => {
      const s = await seed(tx);
      const transcriber = createSidecarTranscribe(sidecar);
      const { gateway, run } = hearingGateway();
      const events = createEventLog();
      const started = performance.now();
      const out = await runVoiceProcess(
        { db: tx, store: s.store, gateway, transcriber, events, now: () => NOW },
        { workspaceId: s.workspaceId, captureId: s.captureId },
      );
      expect(performance.now() - started).toBeLessThan(3000);
      expect(out.outcome).toBe('structured');
      expect(run.mock.calls.map(([task]) => task)).toEqual(['structure_hearing']);
      expect(transcriber.calls[0]?.audio).toEqual(AUDIO);

      const row = await readCapture(tx, s.workspaceId, s.captureId);
      expect(['ready', 'needs_you']).toContain(row.status);
      const voice = row.sourceMeta['voice'] as {
        structured: boolean;
        transcriptDocumentId: string;
      };
      expect(voice.structured).toBe(true);
      const anchors = await inWorkspace(tx, s.workspaceId, (q) =>
        q
          .select()
          .from(schema.anchor)
          .where(eq(schema.anchor.documentId, voice.transcriptDocumentId)),
      );
      expect(anchors.length).toBeGreaterThan(0);
      for (const a of anchors) {
        expect(a.kind).toBe('transcript');
        expect(a.transcriptSpan?.endMs).toBeGreaterThan(a.transcriptSpan?.startMs ?? 0);
      }
      expect(anchors.some((a) => a.quote.includes('fourteenth of November'))).toBe(true);
      expect(events.events.map((e) => e.type)).toEqual([
        'capture.transcribed',
        'capture.structured',
      ]);
    });
  });

  it('does not touch a capture of another workspace', async () => {
    await withTestDb(async (tx) => {
      const a = await seed(tx);
      const b = await newWorkspace(tx);
      const { gateway } = hearingGateway();
      const out = await runVoiceProcess(
        {
          db: tx,
          store: a.store,
          gateway,
          transcriber: createSidecarTranscribe(sidecar),
          now: () => NOW,
        },
        { workspaceId: b.workspaceId, captureId: a.captureId },
      );
      expect(out).toEqual({ outcome: 'missing' });
      expect((await readCapture(tx, a.workspaceId, a.captureId)).status).toBe('processing');
    });
  });
});

describe('recording retention and deletion', () => {
  async function structured(tx: Tx) {
    const s = await seed(tx);
    const { gateway } = hearingGateway();
    await runVoiceProcess(
      {
        db: tx,
        store: s.store,
        gateway,
        transcriber: createSidecarTranscribe(sidecar),
        now: () => NOW,
      },
      { workspaceId: s.workspaceId, captureId: s.captureId },
    );
    const row = await readCapture(tx, s.workspaceId, s.captureId);
    const voice = row.sourceMeta['voice'] as {
      transcriptDocumentId: string;
      transcriptKey: string;
    };
    return { ...s, voice };
  }

  const rows = (tx: Tx, workspaceId: string) =>
    inWorkspace(tx, workspaceId, async (q) => ({
      proposals: await q.select().from(schema.proposal),
      documents: await q.select().from(schema.document),
    }));

  it('the 30-day sweep deletes the audio and leaves the transcript and proposals', async () => {
    await withTestDb(async (tx) => {
      const s = await structured(tx);
      const before = await rows(tx, s.workspaceId);
      const later = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
      await sweepExpiredCaptures({ db: tx, store: s.store, now: () => later }, s.workspaceId);
      await expect(s.store.get(s.key)).rejects.toThrow();
      expect(await s.store.get(s.voice.transcriptKey as ObjectKey)).toBeDefined();
      expect(await rows(tx, s.workspaceId)).toEqual(before);
    });
  });

  it('a user delete removes audio and transcript now, keeps the proposals, and is idempotent', async () => {
    await withTestDb(async (tx) => {
      const s = await structured(tx);
      const before = await rows(tx, s.workspaceId);
      const done = await deleteRecording(s.ctx, s.captureId);
      expect(done.rawStorageKey).toBeNull();
      await expect(s.store.get(s.key)).rejects.toThrow();
      await expect(s.store.get(s.voice.transcriptKey as ObjectKey)).rejects.toThrow();
      const anchors = await inWorkspace(tx, s.workspaceId, (q) =>
        q
          .select()
          .from(schema.anchor)
          .where(eq(schema.anchor.documentId, s.voice.transcriptDocumentId)),
      );
      expect(anchors.length).toBeGreaterThan(0);
      expect(anchors.every((a) => a.quote === '')).toBe(true);
      expect((await rows(tx, s.workspaceId)).proposals).toEqual(before.proposals);
      await expect(deleteRecording(s.ctx, s.captureId)).resolves.toMatchObject({
        rawStorageKey: null,
      });
    });
  });

  it('a member of another workspace cannot delete the recording', async () => {
    await withTestDb(async (tx) => {
      const a = await structured(tx);
      const b = await newWorkspace(tx);
      await expect(
        deleteRecording({ ...a.ctx, workspaceId: b.workspaceId, userId: b.ownerId }, a.captureId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(a.store.get(a.key)).resolves.toBeDefined();
    });
  });
});
