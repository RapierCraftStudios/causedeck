// runJob: workspace scoping, span and log fields, payload privacy (#15).
import { randomUUID } from 'node:crypto';

import { defineJob, PermanentError, runJob, type JobContext } from '@causedeck/core/jobs';
import { testAppDb, withWorkspace } from '@causedeck/db/testing';
import { initTelemetry, type Telemetry } from '@causedeck/observability';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { captureLogger, startTestWorker, stopTestWorkers, uniqueName, waitFor } from './helpers.ts';

const SECRET_CONTENT = 'privileged-note-7f3a';

async function currentWorkspace(ctx: JobContext): Promise<string | null> {
  const rows = await ctx.db.execute<{ ws: string | null }>(
    sql`select nullif(current_setting('app.workspace_id', true), '') as ws`,
  );
  return rows[0]?.ws ?? null;
}

let exporter: InMemorySpanExporter;
let telemetry: Telemetry;

beforeAll(() => {
  exporter = new InMemorySpanExporter();
  telemetry = initTelemetry({ service: 'worker-test', spanExporter: exporter });
});

afterEach(async () => {
  exporter.reset();
  await stopTestWorkers();
});

afterAll(async () => {
  await telemetry.shutdown();
});

describe('workspace scoping', () => {
  it('runs a workspace job inside withWorkspace and clears the setting afterwards', async () => {
    const seen: (string | null)[] = [];
    const def = defineJob({
      name: uniqueName('scope'),
      schema: z.object({ workspaceId: z.uuid() }),
      handler: async (ctx) => {
        seen.push(ctx.workspaceId, await currentWorkspace(ctx));
      },
    });
    const worker = await startTestWorker([def]);
    const workspaceId = randomUUID();
    await worker.boss.send(def.name, { workspaceId });

    await waitFor(() => seen.length === 2);
    expect(seen).toEqual([workspaceId, workspaceId]);
    // SET LOCAL: a later transaction on the same pool sees no workspace.
    const after = await testAppDb().execute<{ ws: string | null }>(
      sql`select nullif(current_setting('app.workspace_id', true), '') as ws`,
    );
    expect(after[0]?.ws ?? null).toBeNull();
  });

  it('runs a system job without a workspace', async () => {
    let seen: string | null | undefined;
    const def = defineJob({
      name: 'system.scope-test',
      schema: z.object({ workspaceId: z.null().optional() }),
      handler: async (ctx) => {
        seen = await currentWorkspace(ctx);
      },
    });
    const outcome = await runJob(
      def,
      { id: randomUUID(), data: {}, retryCount: 0 },
      { db: testAppDb(), logger: captureLogger().logger },
    );

    expect(outcome).toEqual({ status: 'completed' });
    expect(seen).toBeNull();
  });

  it('a handler cannot read another workspace’s rows (cross-tenant job test, #19)', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    // Written inside B's scope (FORCE RLS rejects tenant rows with no workspace pinned).
    await withWorkspace(testAppDb(), { workspaceId: b }, (tx) =>
      tx.execute(
        sql`insert into job_effect (job_name, idempotency_key, workspace_id) values ('test.x', 'k', ${b})`,
      ),
    );
    const inB = await withWorkspace(testAppDb(), { workspaceId: b }, (tx) =>
      tx.execute(sql`select 1 from job_effect where workspace_id = ${b}`),
    );
    expect(inB).toHaveLength(1);
    let visible = -1;
    const def = defineJob({
      name: uniqueName('xtenant'),
      schema: z.object({ workspaceId: z.uuid() }),
      handler: async (ctx) => {
        const rows = await ctx.db.execute(sql`select 1 from job_effect where workspace_id = ${b}`);
        visible = rows.length;
      },
    });
    await runJob(
      def,
      { id: randomUUID(), data: { workspaceId: a }, retryCount: 0 },
      { db: testAppDb(), logger: captureLogger().logger },
    );
    expect(visible).toBe(0);
  });
});

describe('spans and logs', () => {
  const def = defineJob({
    name: 'test.observed',
    schema: z.object({ workspaceId: z.uuid(), noteId: z.string() }),
    handler: async (ctx) => {
      ctx.log.info('working');
      await Promise.resolve();
    },
  });

  it('carry jobName, jobId, attempt and workspaceId and never the payload', async () => {
    const captured = captureLogger();
    const workspaceId = randomUUID();
    const jobId = randomUUID();

    await runJob(
      def,
      { id: jobId, data: { workspaceId, noteId: SECRET_CONTENT }, retryCount: 2 },
      { db: testAppDb(), logger: captured.logger },
    );

    const lines = captured.lines();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatchObject({ jobName: 'test.observed', jobId, attempt: 3, workspaceId });
    }
    expect(captured.raw()).not.toContain(SECRET_CONTENT);

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe('job test.observed');
    expect(span?.attributes).toMatchObject({
      jobName: 'test.observed',
      jobId,
      attempt: 3,
      workspaceId,
    });
    expect(JSON.stringify(span?.attributes)).not.toContain(SECRET_CONTENT);
  });

  it('logs only issue paths when the payload fails validation, and dead-letters it', async () => {
    const captured = captureLogger();
    const outcome = await runJob(
      def,
      {
        id: randomUUID(),
        data: { workspaceId: randomUUID(), noteId: 7, text: SECRET_CONTENT },
        retryCount: 0,
      },
      { db: testAppDb(), logger: captured.logger },
    );

    expect(outcome).toEqual({
      status: 'deadletter',
      error: { name: 'PermanentError', code: 'INVALID_PAYLOAD' },
    });
    expect(captured.raw()).not.toContain(SECRET_CONTENT);
  });

  it('classifies PermanentError as dead-letter and other errors as retryable', async () => {
    const failing = (error: Error) =>
      defineJob({
        name: 'test.failing',
        schema: z.object({ workspaceId: z.uuid() }),
        handler: () => Promise.reject(error),
      });
    const deps = { db: testAppDb(), logger: captureLogger().logger };
    const job = { id: randomUUID(), data: { workspaceId: randomUUID() }, retryCount: 0 };

    await expect(runJob(failing(new PermanentError('GONE')), job, deps)).resolves.toEqual({
      status: 'deadletter',
      error: { name: 'PermanentError', code: 'GONE' },
    });
    await expect(runJob(failing(new Error(SECRET_CONTENT)), job, deps)).resolves.toEqual({
      status: 'failed',
      error: { name: 'Error' },
    });
  });
});
