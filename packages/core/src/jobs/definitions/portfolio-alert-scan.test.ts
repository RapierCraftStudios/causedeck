import { describe, expect, it, vi } from 'vitest';

import { portfolioAlertScan, runPortfolioAlertScan } from './portfolio-alert-scan.ts';

const log = { info: vi.fn(), warn: vi.fn() };

describe('runPortfolioAlertScan', () => {
  it('scans nothing when no institution has tracked cases', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const report = await runPortfolioAlertScan({ db: { execute } as never, log: log as never });
    expect(report).toEqual({ workspaces: 0, adverse: 0, missed: 0, notified: 0, failed: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed workspace id', async () => {
    const execute = vi.fn().mockResolvedValue([{ workspace_id: 'not-a-uuid' }]);
    const report = await runPortfolioAlertScan({ db: { execute } as never, log: log as never });
    expect(report).toMatchObject({ workspaces: 1, adverse: 0, missed: 0, failed: 0 });
  });

  it('counts a failing workspace and goes on to the next', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue([
        { workspace_id: '00000000-0000-4000-8000-000000000001' },
        { workspace_id: 'not-a-uuid' },
      ]);
    const boom = { transaction: () => Promise.reject(new TypeError('down')) };
    const report = await runPortfolioAlertScan(
      { db: { execute } as never, log: log as never },
      { db: boom as never },
    );
    expect(report.workspaces).toBe(2);
    expect(report.failed).toBe(1);
    expect(log.warn).toHaveBeenCalled();
  });

  it('is a scheduled daily system job', () => {
    expect(portfolioAlertScan.name).toBe('system.portfolio-alert.scan');
    expect(portfolioAlertScan.schedule?.cron).toBe('0 6 * * *');
  });
});
