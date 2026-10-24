// `system.coverage.weekly` (#517): the report is emailed to staff with the gaps and the changes, a
// run with no recipient sends nothing, and the schedule is weekly.
import type { EmailTransport } from '@causedeck/notifications/email';
import { describe, expect, it, vi } from 'vitest';

import type { CoverageInputs } from '../../sources/index.ts';

import { coverageWeekly, renderCoverageReport, runCoverageWeekly } from './coverage-weekly.ts';

const NOW = new Date('2026-10-26T04:00:00Z');
const log = { info: vi.fn() } as never;
const inputs: CoverageInputs = {
  forums: [
    {
      code: 'in.ka.bengaluru.family-court',
      court: 'Family',
      establishment: null,
      jurisdictionKind: 'district',
    },
  ],
  sources: [
    {
      id: 'in.ka.district:case_status',
      kind: 'court',
      accessMode: 'A1',
      clearedAt: new Date('2026-10-24T00:00:00Z'),
      killSwitch: false,
    },
  ],
  fetches: [],
  notices: [],
  demand: [{ sourceId: 'in.ka.district:case_status', watches: 4, users: 2 }],
};

describe('runCoverageWeekly', () => {
  it('emails every recipient the gaps and the level changes', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const report = await runCoverageWeekly(
      { db: {} as never, log },
      {
        now: () => NOW,
        inputs: () => Promise.resolve(inputs),
        email: { send } as unknown as EmailTransport,
        recipients: ['a@x.test', 'b@x.test'],
      },
    );
    expect(report).toMatchObject({ sent: 2, changes: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    const message = send.mock.calls[0]?.[0] as { subject: string; text: string };
    expect(message.subject).toContain('2026-10-26');
    expect(message.text).toContain('in.ka.bengaluru.family-court case_status: none to A1');
    expect(message.text).toContain('4 watches, 2 users');
  });

  it('sends nothing without a recipient', async () => {
    const send = vi.fn();
    const report = await runCoverageWeekly(
      { db: {} as never, log },
      {
        now: () => NOW,
        inputs: () => Promise.resolve(inputs),
        email: { send } as unknown as EmailTransport,
        recipients: [],
      },
    );
    expect(report.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('renders escaped HTML and runs on Mondays', () => {
    const m = renderCoverageReport(
      [],
      [{ forumCode: 'a<b', dataType: 'notice', from: 'none', to: 'A0' }],
      { forums: 1, cells: 5, live: 1 },
      '2026-10-26',
    );
    expect(m.html).toContain('a&lt;b');
    expect(coverageWeekly.schedule?.cron).toBe('30 9 * * 1');
  });
});
