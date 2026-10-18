// `runJob` (spike §3.2, §4.1): the one wrapper every handler runs through. It validates the
// payload, scopes the transaction to the payload's workspace, opens a span, binds the log fields
// and classifies failures. Only `jobName`, `jobId`, `attempt` and `workspaceId` reach logs and
// spans; the payload never does.
import { isUuid, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import {
  recordJobDuration,
  withRequestContext,
  withSpan,
  type Logger,
} from '@causedeck/observability';
import { z } from 'zod';

import type { AnyJobDefinition } from './define.ts';
import { PermanentError } from './errors.ts';

export interface JobContext {
  readonly log: Logger;
  /** Inside a workspace job this is the `withWorkspace` transaction. */
  readonly db: Database | Transaction;
  readonly workspaceId: string | null;
  readonly jobName: string;
  readonly jobId: string;
  /** 1 on the first run. */
  readonly attempt: number;
  /** Aborted when the worker shuts down or the job times out. */
  readonly signal: AbortSignal;
  /** Default key for `once()`: the definition's `idempotencyKey(payload)`, else the job id. */
  readonly idempotencyKey: string;
}

/** The parts of a pg-boss job `runJob` reads. */
export interface JobInput {
  readonly id: string;
  readonly data: unknown;
  readonly retryCount: number;
  readonly signal?: AbortSignal;
}

export interface RunJobDeps {
  readonly db: Database;
  readonly logger: Logger;
}

export type JobOutcome =
  | { status: 'completed' }
  | { status: 'failed'; error: JobErrorSummary }
  | { status: 'deadletter'; error: JobErrorSummary };

/** What is stored as the job's output on failure: the error class and code, never a message. */
export interface JobErrorSummary {
  name: string;
  code?: string;
}

function summarize(error: unknown): JobErrorSummary {
  if (!(error instanceof Error)) return { name: 'NonError' };
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' ? { name: error.name, code } : { name: error.name };
}

function workspaceOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as { workspaceId?: unknown }).workspaceId;
  return isUuid(value) ? value : null;
}

/**
 * Run one job. Resolves with the outcome instead of throwing: `failed` is retried by pg-boss (until
 * the retry limit, then dead-lettered), `deadletter` skips the remaining retries.
 */
export async function runJob(
  def: AnyJobDefinition,
  job: JobInput,
  deps: RunJobDeps,
): Promise<JobOutcome> {
  const attempt = job.retryCount + 1;
  const workspaceId = workspaceOf(job.data);
  const fields = { jobName: def.name, jobId: job.id, attempt, workspaceId };
  const log = deps.logger.child(fields);
  const signal = job.signal ?? new AbortController().signal;
  const started = performance.now();

  const outcome = await withRequestContext(
    { requestId: job.id, jobId: job.id, ...(workspaceId !== null && { workspaceId }) },
    async (): Promise<JobOutcome> => {
      try {
        await withSpan(
          `job ${def.name}`,
          async () => {
            const parsed = def.schema.safeParse(job.data);
            if (!parsed.success) {
              // Issue paths only: zod messages may echo values.
              log.error(
                { issues: parsed.error.issues.map((i: z.core.$ZodIssue) => i.path.join('.')) },
                'job payload failed validation',
              );
              throw new PermanentError('INVALID_PAYLOAD', 'job payload failed validation');
            }
            const payload = parsed.data;
            const base = {
              log,
              workspaceId,
              jobName: def.name,
              jobId: job.id,
              attempt,
              signal,
              idempotencyKey: def.idempotencyKey?.(payload) ?? job.id,
            };
            if (workspaceId === null) {
              await def.handler({ ...base, db: deps.db }, payload);
            } else {
              await withWorkspace(deps.db, { workspaceId }, (tx) =>
                def.handler({ ...base, db: tx }, payload),
              );
            }
          },
          { attributes: fields },
        );
        log.info('job completed');
        return { status: 'completed' };
      } catch (error) {
        const summary = summarize(error);
        if (error instanceof PermanentError || error instanceof z.ZodError) {
          log.error({ err: error }, 'job failed permanently; moving to dead-letter queue');
          return { status: 'deadletter', error: summary };
        }
        const final = job.retryCount >= def.retry.limit;
        log.warn(
          { err: error, final },
          final ? 'job failed; retries exhausted' : 'job failed; will retry',
        );
        return { status: 'failed', error: summary };
      }
    },
  );

  recordJobDuration(performance.now() - started, { jobName: def.name, outcome: outcome.status });
  return outcome;
}
