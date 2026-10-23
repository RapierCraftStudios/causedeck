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
  enqueueNotificationDelivery,
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
  activityDigest,
  activityDigestMember,
  activityDigestMemberSchema,
  activityDigestSchedule,
  activityDigestSchema,
  runActivityDigest,
  runActivityDigestMember,
  runActivityDigestSchedule,
  type ActivityDigestMemberPayload,
  type ActivityDigestPayload,
  type ActivityDigestTarget,
  type MemberDigestOutcome,
} from './definitions/activity-digest.ts';
export {
  billingProcessEvent,
  billingProcessEventSchema,
  runBillingProcessEvent,
  type BillingProcessEventOutcome,
  type BillingProcessEventPayload,
} from './definitions/billing-process-event.ts';
export {
  invoicePdfFilename,
  runBillingInvoiceRender,
} from './definitions/billing-invoice-render.ts';
export { billingReconcile, runBillingReconcile } from './definitions/billing-reconcile.ts';
export {
  appLink,
  DELIVERY_CHANNELS,
  deliveryKey,
  notificationDeliver,
  notificationDeliverSchema,
  notificationJobDeps,
  runNotificationDeliver,
  setNotificationJobDeps,
  type DeliverOutcome,
  type DeliveryChannel,
  type DeliveryRecord,
  type DeliveryStatus,
  type NotificationDeliverPayload,
  type NotificationJobDeps,
  type PushSender,
} from './definitions/notification-deliver.ts';
export {
  DEFAULT_DIGEST_TIMEZONE,
  DIGEST_ITEM_LIMIT,
  DIGEST_LOCAL_TIME,
  digestDueAt,
  digestInstant,
  notificationDigest,
  notificationDigestSchedule,
  notificationDigestSchema,
  runNotificationDigest,
  runNotificationDigestSchedule,
  type DigestReport,
  type DigestScheduleDeps,
  type DigestTarget,
  type NotificationDigestPayload,
} from './definitions/notification-digest.ts';
export { JOB_EFFECT_RETENTION_DAYS, retentionSweep } from './definitions/retention-sweep.ts';
export { supportSessionExpire } from './definitions/support-session-expire.ts';
export { systemPing } from './definitions/system-ping.ts';
export {
  runUsageRollup,
  USAGE_SUMMARY_RETENTION_MONTHS,
  usageRollup,
  type UsageRollupDeps,
  type UsageRollupReport,
} from './definitions/usage-rollup.ts';
