// Parse-health monitor (#372): each flag at its threshold (`zero_rows`, `yield_drop` below 50% of
// the 7-run median, the unmapped-heading ratio above 0.2, the unknown-case-type ratio above 0.1,
// `missing_hall_headers` with the affected halls), the status they give, a declared-empty list
// that is not a failure (#396), metrics without row text, and `recordParseRun` storing a run whose
// yield history is its own workspace's, same forum only.
import { adapterParseRun } from '@causedeck/db/schema';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createEchoAdapter,
  ECHO_FORUM_CODE,
  evaluateParseHealth,
  parseRunMetrics,
  PARSE_HEALTH_THRESHOLDS,
  type ParsedCauseList,
  type ParseRunMetrics,
} from '../index.ts';
import { recordParseRun } from '../server.ts';

const metrics = (overrides: Partial<ParseRunMetrics> = {}): ParseRunMetrics => ({
  adapterId: 'echo',
  adapterVersion: '1.0.0',
  forumCode: ECHO_FORUM_CODE,
  rowsParsed: 20,
  rowsAnchored: 20,
  unmappedHeadings: 0,
  unknownCaseTypes: 0,
  hallsSeen: ['1', '2'],
  hallsUnreadable: [],
  headingsSeen: 5,
  rowsWithoutHall: 0,
  ...overrides,
});

const parse = (text: string, forumCode = ECHO_FORUM_CODE): Promise<ParsedCauseList> =>
  createEchoAdapter().parseCauseList({
    kind: 'text',
    text,
    meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode },
  });

const LIST = [
  'CAUSE LIST FOR 21.10.2026',
  'COURT HALL 1',
  'FOR ADMISSION',
  '1. W.P. No. 12345 of 2026  Fictional Petitioner vs Fictional Respondent',
  '2. Q.Z. No. 9 of 2026  Unknown Type Party vs Another Party',
  'SOMETHING NEW',
  '3. W.A. No. 77 of 2025  Appellant Person vs Respondent Person',
  '',
].join('\n');

describe('evaluateParseHealth (#372)', () => {
  it('is ok for a clean run', () => {
    expect(evaluateParseHealth(metrics(), { history: [20, 21, 19] })).toEqual({
      status: 'ok',
      flags: [],
      affectedHalls: [],
    });
  });

  it('fails on zero rows, naming every hall', () => {
    expect(
      evaluateParseHealth(metrics({ rowsAnchored: 0, rowsParsed: 0, hallsUnreadable: ['3'] })),
    ).toEqual({
      status: 'failed',
      flags: ['zero_rows', 'missing_hall_headers'],
      affectedHalls: ['1', '2', '3'],
    });
  });

  it('flags a yield below half the median of the last 7 runs for the forum', () => {
    expect(PARSE_HEALTH_THRESHOLDS).toMatchObject({ yieldDropRatio: 0.5, yieldWindow: 7 });
    const history = [20, 22, 18, 20, 30, 10, 20];
    expect(evaluateParseHealth(metrics({ rowsAnchored: 9 }), { history }).flags).toEqual([
      'yield_drop',
    ]);
    expect(evaluateParseHealth(metrics({ rowsAnchored: 9 }), { history }).status).toBe('degraded');
    // Exactly half the median is not a drop.
    expect(evaluateParseHealth(metrics({ rowsAnchored: 10 }), { history }).flags).toEqual([]);
    // Only the newest 7 runs count: older large runs do not raise the median.
    expect(
      evaluateParseHealth(metrics({ rowsAnchored: 9 }), {
        history: [10, 10, 10, 10, 10, 10, 10, 500, 500, 500],
      }).flags,
    ).toEqual([]);
    // No history, no yield check.
    expect(evaluateParseHealth(metrics({ rowsAnchored: 1 })).flags).toEqual([]);
  });

  it('flags an unmapped-heading ratio above 0.2', () => {
    expect(evaluateParseHealth(metrics({ unmappedHeadings: 1, headingsSeen: 5 })).flags).toEqual(
      [],
    );
    expect(evaluateParseHealth(metrics({ unmappedHeadings: 2, headingsSeen: 5 })).flags).toEqual([
      'unmapped_heading_ratio',
    ]);
  });

  it('flags an unknown-case-type ratio above 0.1', () => {
    expect(evaluateParseHealth(metrics({ unknownCaseTypes: 2 })).flags).toEqual([]);
    expect(evaluateParseHealth(metrics({ unknownCaseTypes: 3 })).flags).toEqual([
      'unknown_case_type_ratio',
    ]);
  });

  it('flags missing hall headers with the affected halls', () => {
    expect(evaluateParseHealth(metrics({ hallsUnreadable: ['4', '3'] }))).toEqual({
      status: 'degraded',
      flags: ['missing_hall_headers'],
      affectedHalls: ['3', '4'],
    });
    expect(evaluateParseHealth(metrics({ rowsWithoutHall: 1 })).flags).toEqual([
      'missing_hall_headers',
    ]);
  });

  it('does not fail a list the parser read as empty (#396), but still fails an unread one', () => {
    const empty = { rowsAnchored: 0, rowsParsed: 0, hallsSeen: ['5'], headingsSeen: 0 };
    expect(evaluateParseHealth(metrics({ ...empty, declaredEmpty: true }))).toEqual({
      status: 'ok',
      flags: [],
      affectedHalls: [],
    });
    expect(evaluateParseHealth(metrics(empty))).toEqual({
      status: 'failed',
      flags: ['zero_rows'],
      affectedHalls: ['5'],
    });
  });
});

describe('parseRunMetrics (#372)', () => {
  it('reduces a parse to counts and hall numbers, without row text', async () => {
    const parsed = await parse(LIST);
    const m = parseRunMetrics(parsed);
    expect(m).toEqual({
      adapterId: 'echo',
      adapterVersion: '1.0.0',
      forumCode: ECHO_FORUM_CODE,
      rowsParsed: 3,
      rowsAnchored: 3,
      unmappedHeadings: 1,
      unknownCaseTypes: 1,
      hallsSeen: ['1'],
      hallsUnreadable: [],
      headingsSeen: 2,
      rowsWithoutHall: 0,
    });
    const json = JSON.stringify(m);
    for (const row of parsed.rows) {
      expect(json).not.toContain(row.anchor.quote);
      if (row.parties !== undefined) expect(json).not.toContain(row.parties);
    }
    // One unknown row in three, one unmapped heading in two: both ratios are over their limits.
    expect(evaluateParseHealth(m).flags).toEqual([
      'unmapped_heading_ratio',
      'unknown_case_type_ratio',
    ]);
  });
});

describe('recordParseRun (#372)', () => {
  it("stores metrics in the workspace and takes the yield history from that workspace's forum only", async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const aDoc = t.a.rows.document?.documentId ?? '';
      const bDoc = t.b.rows.document?.documentId ?? '';
      const forum = `test.health.${t.a.id.slice(0, 8)}`;
      const other = `${forum}.other`;
      const big = await parse(LIST, forum);
      const small = await parse(
        [
          'CAUSE LIST FOR 22.10.2026',
          'COURT HALL 1',
          'FOR ADMISSION',
          '1. W.P. No. 1 of 2026  Fictional Petitioner vs Fictional Respondent',
          '',
        ].join('\n'),
        forum,
      );

      // B's large runs on the same forum code never reach A's history.
      for (let i = 0; i < 3; i += 1) {
        await recordParseRun({ db: tx, workspaceId: t.b.id }, { documentId: bDoc, parsed: big });
      }
      const first = await recordParseRun(
        { db: tx, workspaceId: t.a.id },
        { documentId: aDoc, parsed: small },
      );
      expect(first.health.flags).not.toContain('yield_drop');

      // A's history on another forum does not count either; on this forum it does.
      await recordParseRun(
        { db: tx, workspaceId: t.a.id },
        { documentId: aDoc, parsed: await parse(LIST, other) },
      );
      await recordParseRun({ db: tx, workspaceId: t.a.id }, { documentId: aDoc, parsed: big });
      await recordParseRun({ db: tx, workspaceId: t.a.id }, { documentId: aDoc, parsed: big });
      const dropped = await recordParseRun(
        { db: tx, workspaceId: t.a.id },
        { documentId: aDoc, parsed: small },
      );
      // History newest first: 3, 3, 1 -> median 3; 1 < 1.5.
      expect(dropped.health.flags).toContain('yield_drop');
      expect(dropped.health.status).toBe('degraded');

      const [row] = await inWorkspace(tx, t.a.id, (s) =>
        s.select().from(adapterParseRun).where(eq(adapterParseRun.id, dropped.id)),
      );
      expect(row).toMatchObject({
        workspaceId: t.a.id,
        documentId: aDoc,
        adapterId: 'echo',
        adapterVersion: '1.0.0',
        forumCode: forum,
        rowsParsed: 1,
        rowsAnchored: 1,
        unmappedHeadings: 0,
        unknownCaseTypes: 0,
        hallsSeen: ['1'],
        hallsUnreadable: [],
        status: 'degraded',
      });
      // B cannot see A's run.
      const fromB = await inWorkspace(tx, t.b.id, (s) =>
        s.select().from(adapterParseRun).where(eq(adapterParseRun.id, dropped.id)),
      );
      expect(fromB).toEqual([]);
    });
  });
});
