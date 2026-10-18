// `defineJob` (spike §1, §3.2): one file per job, a required zod schema, explicit retry, concurrency
// and timeout policy. See docs/engineering/jobs.md.
import { z } from 'zod';

import type { JobContext } from './context.ts';

/** `<domain>.<verb>`, e.g. `notification.send`, `document.ocr`, `system.retention.sweep`. */
export const JOB_NAME_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** Fields every payload may carry. `workspaceId` is required except for `system.*` jobs. */
export interface JobPayloadBase {
  workspaceId?: string | null;
  fairnessKey?: string;
}

export interface RetryPolicy {
  /** Retries after the first attempt. Default 4, so 5 attempts in total. */
  limit: number;
  /** Base delay in seconds; doubled per retry when `backoff` is on. Default 5. */
  delaySec: number;
  /** Exponential backoff (`retryBackoff`). Default true. */
  backoff: boolean;
  /** Cap on the backoff delay in seconds. Default 1 hour. */
  delayMaxSec: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  limit: 4,
  delaySec: 5,
  backoff: true,
  delayMaxSec: 3600,
};
export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_TIMEOUT_SEC = 300;
/** Concurrent jobs per `fairnessKey` (default the workspace) across all workers. */
export const DEFAULT_FAIRNESS_CONCURRENCY = 3;

export type SingletonPolicy = 'singleton' | 'short' | 'stately' | 'exclusive';

export interface JobSchedule<P> {
  /** Cron expression, evaluated in `Asia/Kolkata`. */
  cron: string;
  payload: P;
}

type AnyObjectSchema = z.ZodObject<z.ZodRawShape>;

export interface JobSpec<N extends string, S extends AnyObjectSchema> {
  name: N;
  schema: S;
  handler: (ctx: JobContext, payload: z.output<S>) => Promise<void>;
  retry?: Partial<RetryPolicy>;
  concurrency?: number;
  timeoutSec?: number;
  /** pg-boss `singletonKey` and queue policy (default `singleton`: one active job per key). */
  singleton?: { key: (payload: z.output<S>) => string; policy?: SingletonPolicy };
  /** Key `once()` uses by default (`ctx.idempotencyKey`). Defaults to the job id. */
  idempotencyKey?: (payload: z.output<S>) => string;
  /** Concurrent jobs per fairness group. Default 3. */
  fairnessConcurrency?: number;
  schedule?: JobSchedule<z.input<S>>;
}

export interface SingletonOptions<P> {
  key(payload: P): string;
  policy: SingletonPolicy;
}

// Callbacks are declared as methods so a definition with a narrow payload type is assignable to
// `AnyJobDefinition` (method parameters are checked bivariantly).
export interface JobDefinition<
  N extends string = string,
  S extends AnyObjectSchema = AnyObjectSchema,
> {
  readonly name: N;
  readonly schema: S;
  handler(ctx: JobContext, payload: z.output<S>): Promise<void>;
  readonly retry: RetryPolicy;
  readonly concurrency: number;
  readonly timeoutSec: number;
  readonly singleton?: SingletonOptions<z.output<S>>;
  idempotencyKey?(payload: z.output<S>): string;
  readonly fairnessConcurrency: number;
  readonly schedule?: JobSchedule<z.input<S>>;
}

/** Any registered definition, whatever its payload. */
export type AnyJobDefinition = JobDefinition;

export function isSystemJob(name: string): boolean {
  return name.startsWith('system.');
}

export function defineJob<const N extends string, S extends AnyObjectSchema>(
  spec: JobSpec<N, S>,
): JobDefinition<N, S> {
  if (!JOB_NAME_PATTERN.test(spec.name)) {
    throw new TypeError(`defineJob: "${spec.name}" is not a <domain>.<verb> job name`);
  }
  if (!(spec.schema instanceof z.ZodObject)) {
    throw new TypeError(`defineJob(${spec.name}): a zod object schema is required`);
  }
  const workspaceField = spec.schema.shape.workspaceId as z.ZodType | undefined;
  if (!isSystemJob(spec.name)) {
    if (workspaceField === undefined || workspaceField.safeParse(undefined).success) {
      throw new TypeError(`defineJob(${spec.name}): the payload schema must require workspaceId`);
    }
  }
  const concurrency = spec.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError(`defineJob(${spec.name}): concurrency must be a positive integer`);
  }
  return {
    name: spec.name,
    schema: spec.schema,
    handler: spec.handler,
    retry: { ...DEFAULT_RETRY, ...spec.retry },
    concurrency,
    timeoutSec: spec.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
    fairnessConcurrency: spec.fairnessConcurrency ?? DEFAULT_FAIRNESS_CONCURRENCY,
    ...(spec.singleton && {
      singleton: { key: spec.singleton.key, policy: spec.singleton.policy ?? 'singleton' },
    }),
    ...(spec.idempotencyKey && { idempotencyKey: spec.idempotencyKey }),
    ...(spec.schedule && { schedule: spec.schedule }),
  };
}

/** Name of a job's dead-letter queue. */
export function deadLetterQueue(name: string): string {
  return `${name}__dlq`;
}

/** Identifier fields shared by payload schemas. */
export const workspaceIdSchema = z.uuid();
export const fairnessKeySchema = z.string().min(1).max(128).optional();
