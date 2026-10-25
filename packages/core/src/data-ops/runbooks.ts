// The runbook entry of every alert type (#515, D-049). Every alert row carries `runbookUrl(type)`,
// so no alert can be raised without somewhere to look first.
import type { DataOpsAlertType } from './detectors.ts';

export const RUNBOOK_PATH = 'infra/runbooks/data-ops/runbook.md';

/** The heading anchor of each alert type in `RUNBOOK_PATH`. */
export const RUNBOOK_ANCHORS: Readonly<Record<DataOpsAlertType, string>> = Object.freeze({
  freshness: 'freshness-breach',
  error_rate: 'error-rate-spike',
  block_signature: 'block-signature',
  parse_yield: 'parse-yield-drop',
  cost_anomaly: 'cost-anomaly',
  conflict_rate: 'conflict-rate-spike',
});

/** `infra/runbooks/data-ops/runbook.md#<anchor>` for an alert type. */
export function runbookUrl(type: DataOpsAlertType): string {
  return `${RUNBOOK_PATH}#${RUNBOOK_ANCHORS[type]}`;
}
