import { describe, expect, it, vi } from 'vitest';

import { judgmentAlertScan, runJudgmentAlertScan } from './judgment-alert-scan.ts';

const log = { info: vi.fn(), warn: vi.fn() };

describe('runJudgmentAlertScan', () => {
  it('scans nothing when no workspace has a confirmed tag', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const report = await runJudgmentAlertScan({ db: { execute } as never, log: log as never });
    expect(report).toEqual({ workspaces: 0, judgments: 0, alerts: 0, notified: 0, failed: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed workspace id', async () => {
    const execute = vi.fn().mockResolvedValue([{ workspace_id: 'not-a-uuid' }]);
    const report = await runJudgmentAlertScan({ db: { execute } as never, log: log as never });
    // A malformed id is refused by the scan itself and finds nothing.
    expect(report.workspaces).toBe(1);
    expect(report.alerts).toBe(0);
  });

  it('is a scheduled daily system job after the corpus poll', () => {
    expect(judgmentAlertScan.name).toBe('system.judgment-alert.scan');
    expect(judgmentAlertScan.schedule?.cron).toBe('30 5 * * *');
  });
});
