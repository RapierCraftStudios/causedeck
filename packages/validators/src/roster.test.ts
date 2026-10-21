import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BenchChangeAlertInsertSchema,
  BenchRosterEntrySelectSchema,
  BenchRosterInsertSchema,
  ConfirmRosterImportInputSchema,
  DismissBenchChangeAlertInputSchema,
  GetRosterAtInputSchema,
  ListRostersInputSchema,
  PortfolioRuleSchema,
  PreviewRosterImportInputSchema,
  ResolveBenchForHallInputSchema,
  RosterCandidateSchema,
  SupersedeRosterInputSchema,
} from './roster';

/** The paths of a failed parse's issues. */
const issuePaths = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] => (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

const anchor = { pageNo: 2, quote: 'Court Hall 12A  Hon. Justice A  Writ petitions' };
const candidate = {
  hallNo: '12A',
  judges: ['Hon. Justice A'],
  portfolioText: 'Writ petitions of 2020 onwards',
  confidence: 0.82,
  anchor,
};

describe('PortfolioRule (#384)', () => {
  it('accepts the issue shape and an empty rule', () => {
    expect(
      PortfolioRuleSchema.parse({
        caseTypes: ['WP', 'WMP'],
        yearFrom: 2020,
        yearTo: 2024,
        subjectTags: ['service'],
      }),
    ).toEqual({ caseTypes: ['WP', 'WMP'], yearFrom: 2020, yearTo: 2024, subjectTags: ['service'] });
    expect(PortfolioRuleSchema.parse({})).toEqual({});
  });

  it('rejects reversed years, unknown keys and un-normalised case types', () => {
    expect(issuePaths(PortfolioRuleSchema.safeParse({ yearFrom: 2024, yearTo: 2020 }))).toEqual([
      'yearTo',
    ]);
    expect(PortfolioRuleSchema.safeParse({ judges: ['A'] }).success).toBe(false);
    expect(issuePaths(PortfolioRuleSchema.safeParse({ caseTypes: ['W.P.'] }))).toEqual([
      'caseTypes.0',
    ]);
    expect(PortfolioRuleSchema.safeParse({ caseTypes: [] }).success).toBe(false);
  });
});

describe('RosterCandidate (#384)', () => {
  it('accepts a candidate with a location anchor', () => {
    expect(RosterCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(
      RosterCandidateSchema.safeParse({
        ...candidate,
        anchor: {
          ...anchor,
          charStart: 10,
          charEnd: 40,
          bbox: { x: 1, y: 2, width: 3, height: 4 },
        },
      }).success,
    ).toBe(true);
  });

  it('requires an anchor and a confidence within 0..1', () => {
    expect(
      issuePaths(RosterCandidateSchema.safeParse({ ...candidate, anchor: undefined })),
    ).toEqual(['anchor']);
    expect(issuePaths(RosterCandidateSchema.safeParse({ ...candidate, confidence: 1.2 }))).toEqual([
      'confidence',
    ]);
    expect(
      issuePaths(
        RosterCandidateSchema.safeParse({
          ...candidate,
          anchor: { ...anchor, charStart: 40, charEnd: 10 },
        }),
      ),
    ).toEqual(['anchor.charEnd']);
    expect(
      issuePaths(
        RosterCandidateSchema.safeParse({ ...candidate, anchor: { ...anchor, pageNo: 0 } }),
      ),
    ).toEqual(['anchor.pageNo']);
  });
});

describe('roster service inputs (#384)', () => {
  const forumId = randomUUID();
  const entry = { hallNo: '12A', benchId: randomUUID() };

  it('accepts a confirm input and defaults the portfolio text', () => {
    const parsed = ConfirmRosterImportInputSchema.parse({
      forumId,
      effectiveFrom: '2026-11-01',
      effectiveTo: '2026-12-01',
      entries: [
        entry,
        { hallNo: '3', judges: ['Hon. Justice B'], portfolioRule: { yearFrom: 2019 } },
      ],
    });
    expect(parsed.entries[0]?.portfolioText).toBe('');
  });

  it('rejects an empty roster, a reversed period and an entry without a bench or judges', () => {
    const base = { forumId, effectiveFrom: '2026-11-01' };
    expect(issuePaths(ConfirmRosterImportInputSchema.safeParse({ ...base, entries: [] }))).toEqual([
      'entries',
    ]);
    expect(
      issuePaths(
        ConfirmRosterImportInputSchema.safeParse({
          ...base,
          effectiveTo: '2026-11-01',
          entries: [entry],
        }),
      ),
    ).toEqual(['effectiveTo']);
    expect(
      issuePaths(
        ConfirmRosterImportInputSchema.safeParse({ ...base, entries: [{ hallNo: '12A' }] }),
      ),
    ).toEqual(['entries.0.benchId']);
    expect(
      ConfirmRosterImportInputSchema.safeParse({ ...base, entries: [entry], extra: true }).success,
    ).toBe(false);
  });

  it('needs a hall id or number to resolve a bench', () => {
    expect(
      issuePaths(ResolveBenchForHallInputSchema.safeParse({ forumId, on: '2026-11-02' })),
    ).toEqual(['hallId']);
    expect(
      ResolveBenchForHallInputSchema.safeParse({ forumId, on: '2026-11-02', hallNo: '12A' })
        .success,
    ).toBe(true);
  });

  it('parses the remaining inputs strictly', () => {
    const id = randomUUID();
    expect(PreviewRosterImportInputSchema.safeParse({ forumId, documentId: id }).success).toBe(
      true,
    );
    expect(GetRosterAtInputSchema.safeParse({ forumId, on: '2026-11-02' }).success).toBe(true);
    expect(GetRosterAtInputSchema.safeParse({ forumId, on: '2.11.2026' }).success).toBe(false);
    expect(ListRostersInputSchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(ListRostersInputSchema.safeParse({ status: 'archived' }).success).toBe(false);
    expect(
      SupersedeRosterInputSchema.safeParse({ rosterId: id, effectiveFrom: '2027-01-01' }).success,
    ).toBe(true);
    expect(DismissBenchChangeAlertInputSchema.safeParse({ alertId: 'x' }).success).toBe(false);
  });
});

describe('roster table schemas (#384)', () => {
  const now = new Date();

  it('parses rows and inserts', () => {
    const workspaceId = randomUUID();
    expect(
      BenchRosterInsertSchema.safeParse({
        workspaceId,
        forumId: randomUUID(),
        effectiveFrom: '2026-11-01',
        version: 1,
      }).success,
    ).toBe(true);
    expect(
      issuePaths(
        BenchRosterInsertSchema.safeParse({
          workspaceId,
          forumId: randomUUID(),
          effectiveFrom: '2026-11-01',
          effectiveTo: '2026-10-01',
          version: 1,
        }),
      ),
    ).toEqual(['effectiveTo']);
    expect(
      BenchRosterEntrySelectSchema.safeParse({
        id: randomUUID(),
        workspaceId,
        rosterId: randomUUID(),
        hallId: null,
        hallNo: '12A',
        benchId: randomUUID(),
        portfolioText: '',
        portfolioRule: { caseTypes: ['WP'] },
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(true);
    expect(
      BenchChangeAlertInsertSchema.safeParse({
        workspaceId,
        proceedingId: randomUUID(),
        rosterId: randomUUID(),
        newBenchId: randomUUID(),
        reason: 'judge',
      }).success,
    ).toBe(false);
  });
});
