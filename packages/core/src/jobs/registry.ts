// The typed job registry (spike §1): one map from job name to definition, and the type-safe
// `enqueue` every producer uses. Adding a job is one file in `definitions/` plus one entry below.
import type { SendOptions } from 'pg-boss';
import type { z } from 'zod';

import { accountDelete } from './definitions/account-delete.ts';
import {
  activityDigest,
  activityDigestMember,
  activityDigestSchedule,
} from './definitions/activity-digest.ts';
import {
  obligationReminders,
  obligationRemindersSchedule,
} from './definitions/obligation-reminders.ts';
import { attentionScan, attentionScanSchedule } from './definitions/attention-scan.ts';
import {
  reminderEvening,
  reminderMorning,
  reminderOutcomeMissing,
  reminderSchedule,
} from './definitions/reminders.ts';
import { courtDataRetention } from './definitions/court-data-retention.ts';
import { newsDigest, newsDigestMember, newsDigestSchedule } from './definitions/news-digest.ts';
import { newsPoll, systemNewsPoll } from './definitions/news-poll.ts';
import { auditRetention } from './definitions/audit-retention.ts';
import { backupHealth } from './definitions/backup-health.ts';
import { auditVerify, systemAuditVerify } from './definitions/audit-verify.ts';
import { systemDataOpsEvaluate } from './definitions/data-ops-evaluate.ts';
import { billingDunningTick } from './definitions/billing-dunning-tick.ts';
import { billingInvoiceNotice } from './definitions/billing-invoice-notice.ts';
import { billingInvoiceRender } from './definitions/billing-invoice-render.ts';
import { billingProcessEvent } from './definitions/billing-process-event.ts';
import { billingReconcile } from './definitions/billing-reconcile.ts';
import { businessCostAlert } from './definitions/business-cost-alert.ts';
import { businessDigest } from './definitions/business-digest.ts';
import { coverageWeekly } from './definitions/coverage-weekly.ts';
import { captureProcess } from './definitions/capture-process.ts';
import { captureRetention, systemCaptureRetention } from './definitions/capture-retention.ts';
import { captureScan } from './definitions/capture-scan.ts';
import { corpusPoll } from './definitions/corpus-poll.ts';
import { judgmentAlertScan } from './definitions/judgment-alert-scan.ts';
import { briefRefresh, briefRefreshSweep } from './definitions/brief-refresh.ts';
import { portfolioAlertScan } from './definitions/portfolio-alert-scan.ts';
import { ordersPoll } from './definitions/orders-poll.ts';
import { statusPoll } from './definitions/status-poll.ts';
import { webhookDeliver } from './definitions/webhook-deliver.ts';
import { systemWebhookSweep } from './definitions/webhook-sweep.ts';
import { extractOrder } from './definitions/extraction-extract-order.ts';
import { importBatch, importFile } from './definitions/import-batch.ts';
import { voiceProcess } from './definitions/voice-process.ts';
import { whatsappImport } from './definitions/whatsapp-import.ts';
import { whatsappIntake } from './definitions/whatsapp-intake.ts';
import { emailIntake } from './definitions/email-intake.ts';
import { emailRawExpire } from './definitions/email-raw-expire.ts';
import { deletionErase } from './definitions/deletion-erase.ts';
import { deletionTick } from './definitions/deletion-tick.ts';
import { boardPoll } from './definitions/board-poll.ts';
import { causelistPoll } from './definitions/causelist-poll.ts';
import { noticesPoll } from './definitions/notices-poll.ts';
import { draftingCitationsCheck } from './definitions/drafting-citations-check.ts';
import { draftingConsistencyCheck } from './definitions/drafting-consistency-check.ts';
import { draftingExport } from './definitions/drafting-export.ts';
import { exportBuild } from './definitions/export-build.ts';
import { exportExpire } from './definitions/export-expire.ts';
import { memoryErase } from './definitions/memory-erase.ts';
import { memoryPurge, systemMemoryPurge } from './definitions/memory-purge.ts';
import {
  memoryReviewPrepare,
  systemMemoryReviewPrepare,
} from './definitions/memory-review-prepare.ts';
import { notificationDeliver } from './definitions/notification-deliver.ts';
import {
  notificationDigest,
  notificationDigestSchedule,
} from './definitions/notification-digest.ts';
import { retentionSweep } from './definitions/retention-sweep.ts';
import { supportSessionExpire } from './definitions/support-session-expire.ts';
import { systemPing } from './definitions/system-ping.ts';
import { usageRollup } from './definitions/usage-rollup.ts';
import type { AnyJobDefinition, JobPayloadBase } from './define.ts';
import { getProducer, type JobSender } from './producer.ts';

/** Payload fields that would carry matter content. Payloads hold identifiers only. */
export const BANNED_PAYLOAD_FIELDS: readonly string[] = [
  'content',
  'text',
  'body',
  'prompt',
  'transcript',
];

interface ZodDefLike {
  type?: string;
  shape?: Record<string, { _zod?: { def?: ZodDefLike } }>;
  innerType?: { _zod?: { def?: ZodDefLike } };
  element?: { _zod?: { def?: ZodDefLike } };
  options?: { _zod?: { def?: ZodDefLike } }[];
  in?: { _zod?: { def?: ZodDefLike } };
}

function bannedFields(def: ZodDefLike | undefined, path: string, out: string[]): void {
  if (def === undefined) return;
  if (def.shape !== undefined) {
    for (const [key, field] of Object.entries(def.shape)) {
      const at = path === '' ? key : `${path}.${key}`;
      if (BANNED_PAYLOAD_FIELDS.includes(key)) out.push(at);
      bannedFields(field._zod?.def, at, out);
    }
  }
  bannedFields(def.innerType?._zod?.def, path, out);
  bannedFields(def.element?._zod?.def, `${path}[]`, out);
  bannedFields(def.in?._zod?.def, path, out);
  for (const option of def.options ?? []) bannedFields(option._zod?.def, path, out);
}

/** `<job>: <field path>` for every banned field declared by a payload schema, at any depth. */
export function contentFieldViolations(defs: readonly AnyJobDefinition[]): string[] {
  return defs.flatMap((def) => {
    const fields: string[] = [];
    bannedFields((def.schema as { _zod?: { def?: ZodDefLike } })._zod?.def, '', fields);
    return fields.map((field) => `${def.name}: ${field}`);
  });
}

export type RegistryMap<D extends readonly AnyJobDefinition[]> = {
  [K in D[number] as K['name']]: K;
};

export interface EnqueueOptions {
  startAfter?: Date | number;
  priority?: number;
}

export interface JobRegistry<M extends Record<string, AnyJobDefinition>> {
  readonly definitions: readonly AnyJobDefinition[];
  get(name: string): AnyJobDefinition | undefined;
  /**
   * Validate `payload` against the job's schema and send it. A payload that fails the schema
   * throws a `ZodError` here and never reaches the queue.
   */
  enqueue<N extends keyof M & string>(
    sender: JobSender,
    name: N,
    payload: z.input<M[N]['schema']>,
    options?: EnqueueOptions,
  ): Promise<string | null>;
}

export function createRegistry<const D extends readonly AnyJobDefinition[]>(
  defs: D,
): JobRegistry<RegistryMap<D>> {
  const byName = new Map<string, AnyJobDefinition>();
  for (const def of defs) {
    if (byName.has(def.name)) throw new TypeError(`job registry: duplicate job "${def.name}"`);
    byName.set(def.name, def);
  }
  const violations = contentFieldViolations(defs);
  if (violations.length > 0) {
    throw new TypeError(`job registry: payloads carry ids only; found ${violations.join(', ')}`);
  }

  return {
    definitions: defs,
    get: (name) => byName.get(name),
    enqueue: async (sender, name, payload, options = {}) => {
      const def = byName.get(name);
      if (def === undefined) throw new TypeError(`enqueue: unknown job "${name}"`);
      const data = def.schema.parse(payload);
      const send: SendOptions = { ...options };
      if (def.singleton !== undefined) send.singletonKey = def.singleton.key(data);
      const { fairnessKey, workspaceId } = data as JobPayloadBase;
      const group = fairnessKey ?? workspaceId;
      if (typeof group === 'string') send.group = { id: group };
      return sender.send(def.name, data, send);
    },
  };
}

/** Every job the platform runs. */
export const registry = createRegistry([
  systemPing,
  retentionSweep,
  courtDataRetention,
  billingReconcile,
  billingDunningTick,
  billingProcessEvent,
  billingInvoiceRender,
  billingInvoiceNotice,
  notificationDeliver,
  notificationDigestSchedule,
  notificationDigest,
  activityDigestSchedule,
  activityDigest,
  activityDigestMember,
  newsDigestSchedule,
  newsDigest,
  newsDigestMember,
  systemNewsPoll,
  newsPoll,
  usageRollup,
  businessCostAlert,
  businessDigest,
  coverageWeekly,
  systemAuditVerify,
  auditVerify,
  auditRetention,
  backupHealth,
  exportBuild,
  draftingExport,
  draftingCitationsCheck,
  draftingConsistencyCheck,
  exportExpire,
  supportSessionExpire,
  deletionTick,
  deletionErase,
  accountDelete,
  memoryErase,
  systemMemoryPurge,
  memoryPurge,
  systemMemoryReviewPrepare,
  memoryReviewPrepare,
  captureScan,
  captureProcess,
  systemCaptureRetention,
  captureRetention,
  whatsappImport,
  voiceProcess,
  emailIntake,
  whatsappIntake,
  emailRawExpire,
  extractOrder,
  importBatch,
  importFile,
  systemDataOpsEvaluate,
  corpusPoll,
  causelistPoll,
  boardPoll,
  noticesPoll,
  judgmentAlertScan,
  portfolioAlertScan,
  statusPoll,
  webhookDeliver,
  systemWebhookSweep,
  ordersPoll,
  obligationRemindersSchedule,
  obligationReminders,
  attentionScanSchedule,
  attentionScan,
  briefRefresh,
  briefRefreshSweep,
  reminderSchedule,
  reminderEvening,
  reminderMorning,
  reminderOutcomeMissing,
] as const);

export type JobMap = RegistryMap<
  readonly [
    typeof systemPing,
    typeof retentionSweep,
    typeof courtDataRetention,
    typeof billingReconcile,
    typeof billingDunningTick,
    typeof billingProcessEvent,
    typeof billingInvoiceRender,
    typeof billingInvoiceNotice,
    typeof notificationDeliver,
    typeof notificationDigestSchedule,
    typeof notificationDigest,
    typeof activityDigestSchedule,
    typeof activityDigest,
    typeof activityDigestMember,
    typeof newsDigestSchedule,
    typeof newsDigest,
    typeof newsDigestMember,
    typeof systemNewsPoll,
    typeof newsPoll,
    typeof usageRollup,
    typeof businessCostAlert,
    typeof businessDigest,
    typeof coverageWeekly,
    typeof systemAuditVerify,
    typeof auditVerify,
    typeof auditRetention,
    typeof backupHealth,
    typeof exportBuild,
    typeof draftingExport,
    typeof draftingCitationsCheck,
    typeof draftingConsistencyCheck,
    typeof exportExpire,
    typeof supportSessionExpire,
    typeof deletionTick,
    typeof deletionErase,
    typeof accountDelete,
    typeof memoryErase,
    typeof systemMemoryPurge,
    typeof memoryPurge,
    typeof systemMemoryReviewPrepare,
    typeof memoryReviewPrepare,
    typeof captureScan,
    typeof captureProcess,
    typeof systemCaptureRetention,
    typeof captureRetention,
    typeof whatsappImport,
    typeof voiceProcess,
    typeof emailIntake,
    typeof whatsappIntake,
    typeof emailRawExpire,
    typeof extractOrder,
    typeof importBatch,
    typeof importFile,
    typeof systemDataOpsEvaluate,
    typeof corpusPoll,
    typeof causelistPoll,
    typeof boardPoll,
    typeof noticesPoll,
    typeof judgmentAlertScan,
    typeof portfolioAlertScan,
    typeof statusPoll,
    typeof webhookDeliver,
    typeof systemWebhookSweep,
    typeof ordersPoll,
    typeof obligationRemindersSchedule,
    typeof obligationReminders,
    typeof attentionScanSchedule,
    typeof attentionScan,
    typeof briefRefresh,
    typeof briefRefreshSweep,
    typeof reminderSchedule,
    typeof reminderEvening,
    typeof reminderMorning,
    typeof reminderOutcomeMissing,
  ]
>;
export type JobName = keyof JobMap;
export type PayloadOf<N extends JobName> = z.input<JobMap[N]['schema']>;

export interface ProducerEnqueueOptions extends EnqueueOptions {
  /** Defaults to the process-wide app-role producer. */
  sender?: JobSender;
}

/** Type-safe producer used by web, api and worker: `enqueue('system.ping', { workspaceId })`. */
export async function enqueue<N extends JobName>(
  name: N,
  payload: PayloadOf<N>,
  { sender, ...options }: ProducerEnqueueOptions = {},
): Promise<string | null> {
  // Validate before connecting, so a bad payload fails fast even without a database.
  registry.get(name)?.schema.parse(payload);
  return registry.enqueue(sender ?? (await getProducer()), name, payload, options);
}

/**
 * `NotifyContext.enqueueDelivery` for `notify()` (`@causedeck/notifications`): one
 * `notification.deliver` job per notification and channel.
 */
export function enqueueNotificationDelivery(
  job: PayloadOf<'notification.deliver'>,
  options: ProducerEnqueueOptions = {},
): Promise<string | null> {
  return enqueue('notification.deliver', job, options);
}
