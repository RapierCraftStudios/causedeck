// Bulk captcha scheduler alerts to the data-ops sink (#1078, #492). The scheduler in
// `@causedeck/fetch` raises block, error and backoff events; each is routed through the same
// notifier (Slack, email, or the log) the SLO evaluator uses, naming the on-call member and the
// runbook of the matching alert type. These are event notices from an in-memory scheduler, not
// ledger rows: the scheduler's own thresholds already say when to speak, so there is no
// open/resolve cycle here. The event type is structural (core does not import the scheduler's).
import type { Queryable } from '@causedeck/db';

import { currentOncall } from './alerts.ts';
import type { DataOpsAlertType } from './detectors.ts';
import { runbookUrl } from './runbooks.ts';
import type { AlertMessage, AlertNotifier } from './routing.ts';

export type BulkAlertEvent =
  | { kind: 'block'; host: string; sourceId: string; signature: string; at: Date }
  | { kind: 'error'; host: string; sourceId: string; consecutive: number; at: Date }
  | { kind: 'host_backoff'; host: string; until: Date; reason: 'blocks' | 'errors'; at: Date };

const typeOf = (event: BulkAlertEvent): DataOpsAlertType =>
  event.kind === 'block' || (event.kind === 'host_backoff' && event.reason === 'blocks')
    ? 'block_signature'
    : 'error_rate';

/** The notice for one event: counts, hosts and times only. */
export function bulkAlertMessage(event: BulkAlertEvent, oncallEmail: string | null): AlertMessage {
  const type = typeOf(event);
  const base = { id: `bulk:${event.kind}:${event.host}:${String(event.at.getTime())}`, type };
  const common = { runbookUrl: runbookUrl(type), oncallEmail };
  switch (event.kind) {
    case 'block':
      return {
        ...base,
        ...common,
        sourceId: event.sourceId,
        detail: `bulk captcha crawl blocked by ${event.host} (${event.signature})`,
      };
    case 'error':
      return {
        ...base,
        ...common,
        sourceId: event.sourceId,
        detail: `bulk captcha crawl: ${String(event.consecutive)} consecutive errors from ${event.host}`,
      };
    case 'host_backoff':
      return {
        ...base,
        ...common,
        sourceId: event.host,
        detail: `bulk captcha crawl backed off from ${event.host} until ${event.until.toISOString()} after repeated ${event.reason}`,
      };
  }
}

/** Structurally the scheduler's `BulkAlertSink`. A sink failure is the scheduler's to swallow. */
export function createBulkAlertSink(deps: {
  /** Read on every alert, so the current job's notifier is used. */
  notifier: () => AlertNotifier;
  db?: Queryable;
}): { alert(event: BulkAlertEvent): Promise<void> } {
  return {
    async alert(event) {
      let email: string | null = null;
      if (deps.db !== undefined) {
        email = (await currentOncall(deps.db, event.at).catch(() => null))?.email ?? null;
      }
      await deps.notifier().opened(bulkAlertMessage(event, email));
    },
  };
}
