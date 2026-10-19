// `@causedeck/core/jobs`: background job framework (#15). See docs/engineering/jobs.md.
export {
  DEFAULT_CONCURRENCY,
  DEFAULT_FAIRNESS_CONCURRENCY,
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_SEC,
  deadLetterQueue,
  defineJob,
  fairnessKeySchema,
  isSystemJob,
  JOB_NAME_PATTERN,
  workspaceIdSchema,
  type AnyJobDefinition,
  type JobDefinition,
  type JobPayloadBase,
  type JobSchedule,
  type JobSpec,
  type RetryPolicy,
  type SingletonOptions,
  type SingletonPolicy,
} from './define.ts';
export {
  runJob,
  type JobContext,
  type JobErrorSummary,
  type JobInput,
  type JobOutcome,
  type RunJobDeps,
} from './context.ts';
export { PermanentError, RetryableError } from './errors.ts';
export { once, type OnceResult } from './idempotency.ts';
export {
  closeProducer,
  createProducer,
  getProducer,
  PGBOSS_SCHEMA,
  type JobSender,
} from './producer.ts';
export {
  BANNED_PAYLOAD_FIELDS,
  contentFieldViolations,
  createRegistry,
  enqueue,
  registry,
  type EnqueueOptions,
  type JobMap,
  type JobName,
  type JobRegistry,
  type PayloadOf,
  type ProducerEnqueueOptions,
  type RegistryMap,
} from './registry.ts';
export {
  billingProcessEvent,
  billingProcessEventSchema,
  runBillingProcessEvent,
  type BillingProcessEventOutcome,
  type BillingProcessEventPayload,
} from './definitions/billing-process-event.ts';
export { billingReconcile, runBillingReconcile } from './definitions/billing-reconcile.ts';
export { JOB_EFFECT_RETENTION_DAYS, retentionSweep } from './definitions/retention-sweep.ts';
export { systemPing } from './definitions/system-ping.ts';
