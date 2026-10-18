// DLQ CLI: list, show (redacted), retry, purge (and refuse to purge without --older-than) (#15).
import { randomUUID } from 'node:crypto';

import { deadLetterQueue, defineJob, PermanentError } from '@causedeck/core/jobs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseArgs, redactPayload, runDlq, UsageError, type DlqDeps } from '../cli/dlq.ts';
import type { Worker } from '../worker.ts';

import { startTestWorker, stopTestWorkers, uniqueName, waitFor } from './helpers.ts';

const SECRET_CONTENT = 'privileged-note-7f3a';

describe('parseArgs', () => {
  it('parses every command', () => {
    expect(parseArgs(['list'])).toEqual({ cmd: 'list' });
    expect(parseArgs(['show', 'abc'])).toEqual({ cmd: 'show', id: 'abc' });
    expect(parseArgs(['retry', 'abc'])).toEqual({ cmd: 'retry', id: 'abc' });
    expect(parseArgs(['purge', '--older-than', '30d'])).toEqual({
      cmd: 'purge',
      olderThanMs: 30 * 86_400_000,
    });
    expect(parseArgs(['purge', '--older-than=12h'])).toEqual({
      cmd: 'purge',
      olderThanMs: 12 * 3_600_000,
    });
  });

  it('refuses to purge without --older-than', () => {
    expect(() => parseArgs(['purge'])).toThrow(UsageError);
    expect(() => parseArgs(['purge'])).toThrow(/refusing to purge without --older-than/);
    expect(() => parseArgs(['purge', '--older-than'])).toThrow(UsageError);
    expect(() => parseArgs(['purge', '--older-than', 'soon'])).toThrow(UsageError);
    expect(() => parseArgs(['purge', '--older-than', '0d'])).toThrow(UsageError);
  });

  it('rejects unknown commands and missing ids', () => {
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs(['drop'])).toThrow(UsageError);
    expect(() => parseArgs(['show'])).toThrow(UsageError);
  });
});

describe('redactPayload', () => {
  it('keeps identifiers and hides content and secrets at any depth', () => {
    expect(
      redactPayload({
        workspaceId: 'w-1',
        transcript: SECRET_CONTENT,
        nested: [{ body: SECRET_CONTENT, documentId: 'd-1' }],
        apiToken: 'tok',
      }),
    ).toEqual({
      workspaceId: 'w-1',
      transcript: `[CONTENT_REDACTED:${String(SECRET_CONTENT.length)}]`,
      nested: [{ body: `[CONTENT_REDACTED:${String(SECRET_CONTENT.length)}]`, documentId: 'd-1' }],
      apiToken: '[REDACTED]',
    });
  });
});

describe('runDlq against pg-boss', () => {
  let worker: Worker;
  let attempts = 0;
  const def = defineJob({
    name: uniqueName('dlq'),
    schema: z.object({ workspaceId: z.uuid(), documentId: z.string() }),
    handler: () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new PermanentError('BROKEN')) : Promise.resolve();
    },
  });
  const workspaceId = randomUUID();
  let deadId = '';
  const out: string[] = [];
  let deps: DlqDeps;

  beforeAll(async () => {
    worker = await startTestWorker([def]);
    deps = { boss: worker.boss, registry: { definitions: [def] }, out: (l) => out.push(l) };
    await worker.boss.send(def.name, { workspaceId, documentId: 'doc-1' });
    // A dead-lettered payload that (wrongly) carries content must still print redacted.
    await worker.boss.send(deadLetterQueue(def.name), {
      workspaceId,
      documentId: 'doc-2',
      text: SECRET_CONTENT,
    });
    const found = await waitFor(async () => {
      const jobs = await worker.boss.findJobs(deadLetterQueue(def.name));
      return jobs.length === 2 && jobs;
    });
    deadId = found.find((j) => (j.data as { documentId: string }).documentId === 'doc-1')?.id ?? '';
  });

  afterAll(async () => {
    await stopTestWorkers();
  });

  it('lists dead-lettered jobs without payloads', async () => {
    out.length = 0;
    expect(await runDlq({ cmd: 'list' }, deps)).toBe(0);
    expect(out.at(-1)).toBe('2 dead-lettered job(s)');
    expect(out.join('\n')).toContain(deadId);
    expect(out.join('\n')).not.toContain(SECRET_CONTENT);
  });

  it('shows one job with the payload redacted', async () => {
    const all = await worker.boss.findJobs(deadLetterQueue(def.name));
    const withContent = all.find((j) => j.id !== deadId);
    out.length = 0;
    expect(await runDlq({ cmd: 'show', id: withContent?.id ?? '' }, deps)).toBe(0);
    const shown = JSON.parse(out.join('\n')) as { payload: Record<string, unknown> };
    expect(shown.payload).toEqual({
      workspaceId,
      documentId: 'doc-2',
      text: `[CONTENT_REDACTED:${String(SECRET_CONTENT.length)}]`,
    });
    expect(out.join('\n')).not.toContain(SECRET_CONTENT);

    out.length = 0;
    expect(await runDlq({ cmd: 'show', id: deadId }, deps)).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({
      queue: deadLetterQueue(def.name),
      sourceName: def.name,
      error: { error: { name: 'PermanentError', code: 'BROKEN' } },
    });
    expect(await runDlq({ cmd: 'show', id: randomUUID() }, deps)).toBe(1);
  });

  it('retries a job back onto its source queue', async () => {
    out.length = 0;
    expect(await runDlq({ cmd: 'retry', id: deadId }, deps)).toBe(0);
    await waitFor(() => attempts === 2);
    const remaining = await worker.boss.findJobs(deadLetterQueue(def.name));
    expect(remaining.map((j) => j.id)).not.toContain(deadId);
  });

  it('purges only jobs older than the cutoff', async () => {
    out.length = 0;
    expect(await runDlq({ cmd: 'purge', olderThanMs: 30 * 86_400_000 }, deps)).toBe(0);
    expect(out).toEqual(['purged 0 dead-lettered job(s)']);
    expect(await worker.boss.findJobs(deadLetterQueue(def.name))).toHaveLength(1);

    out.length = 0;
    const future = () => new Date(Date.now() + 31 * 86_400_000);
    expect(
      await runDlq({ cmd: 'purge', olderThanMs: 30 * 86_400_000 }, { ...deps, now: future }),
    ).toBe(0);
    expect(out).toEqual(['purged 1 dead-lettered job(s)']);
    expect(await worker.boss.findJobs(deadLetterQueue(def.name))).toHaveLength(0);
  });
});
