// Cross-tenant portfolio services (#663): user `ub`, working in workspace B, passes workspace A's
// portfolio id (and, once, A's workspace id). Every call is refused (NOT_FOUND or FORBIDDEN) and A's
// cases and watches are unchanged; B's own portfolio never shows an A row. Kept beside
// services.test.ts (a hotspot) and driven by the same registry, so a registered service without a
// case fails.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/portfolio.test.ts';
const CSV = 'cnr\r\nTNCH010012342024\r\n';

interface Fixture extends TwoTenants {
  tx: Transaction;
  aPortfolioId: string;
  bPortfolioId: string;
}

type Case = (f: Fixture) => Promise<void>;

async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(core.WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN']).toContain((error as core.WorkspaceError).code);
}

async function aState(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    cases: await s.select().from(schema.portfolioCase).orderBy(schema.portfolioCase.id),
    watches: await s.select().from(schema.caseWatch).orderBy(schema.caseWatch.id),
  }));
}

const asB = (f: Fixture) => ({ userId: f.ub, workspaceId: f.b.id });
const asBInA = (f: Fixture) => ({ userId: f.ub, workspaceId: f.a.id });

const CASES: Record<string, Case> = {
  importPortfolioCases: async (f) => {
    const before = await aState(f);
    const input = { portfolioId: f.aPortfolioId, csv: CSV };
    await expectDenied(core.importPortfolioCases({ db: f.tx }, asB(f), input));
    await expectDenied(core.importPortfolioCases({ db: f.tx }, asBInA(f), input));
    expect(await aState(f)).toEqual(before);
  },
  listPortfolioCases: async (f) => {
    const input = { portfolioId: f.aPortfolioId };
    await expectDenied(core.listPortfolioCases({ db: f.tx }, asB(f), input));
    await expectDenied(core.listPortfolioCases({ db: f.tx }, asBInA(f), input));
    expect(
      await core.listPortfolioCases({ db: f.tx }, asB(f), { portfolioId: f.bPortfolioId }),
    ).toEqual([]);
  },
  portfolioSummary: async (f) => {
    const input = { portfolioId: f.aPortfolioId };
    await expectDenied(core.portfolioSummary({ db: f.tx }, asB(f), input));
    await expectDenied(core.portfolioSummary({ db: f.tx }, asBInA(f), input));
    const own = await core.portfolioSummary({ db: f.tx }, asB(f), { portfolioId: f.bPortfolioId });
    expect(own.total).toBe(0);
  },
  exportPortfolioCsv: async (f) => {
    const input = { portfolioId: f.aPortfolioId };
    await expectDenied(core.exportPortfolioCsv({ db: f.tx }, asB(f), input));
    await expectDenied(core.exportPortfolioCsv({ db: f.tx }, asBInA(f), input));
    const own = await core.exportPortfolioCsv({ db: f.tx }, asB(f), {
      portfolioId: f.bPortfolioId,
    });
    expect(own.trim().split('\r\n')).toHaveLength(1);
  },
  scanPortfolioAlerts: async (f) => {
    const now = new Date('2026-11-01T00:00:00Z');
    const deps = { db: f.tx, enqueueDelivery: () => Promise.resolve(null), now: () => now };
    const mark = (workspaceId: string) =>
      inWorkspace(f.tx, workspaceId, (s) =>
        s
          .update(schema.portfolioCase)
          .set({ lastAdverseOrderAt: new Date('2026-10-31T00:00:00Z') }),
      );
    const notices = (workspaceId: string) =>
      inWorkspace(f.tx, workspaceId, (s) => s.select().from(schema.notification));
    // B has an adverse order only in its own workspace: scanning B alerts B's members and not A's.
    await mark(f.a.id);
    const aBefore = await notices(f.a.id);
    const report = await core.scanPortfolioAlerts(deps, f.b.id);
    expect(report.adverse).toBe(0);
    expect(await notices(f.a.id)).toEqual(aBefore);
    // Scanning A alerts A's members only; B gets nothing.
    const bBefore = await notices(f.b.id);
    const own = await core.scanPortfolioAlerts(deps, f.a.id);
    expect(own.adverse).toBeGreaterThan(0);
    expect(await notices(f.b.id)).toEqual(bBefore);
  },
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant portfolio services: ub on workspace B against A (#663)', () => {
  it('has a case for every service the registry points here', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((name) => !(name in CASES))).toEqual([]);
    expect(Object.keys(CASES).filter((name) => !registered.includes(name))).toEqual([]);
  });

  it.each(registered)('%s', async (name) => {
    const run = CASES[name];
    if (run === undefined) throw new Error(`no cross-tenant case for ${name}`);
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const aPortfolioId = seeded.a.rows.portfolio_case?.portfolioId;
      if (aPortfolioId === undefined) throw new Error('two-tenant portfolio seed rows missing');
      const bPortfolio = seeded.b.rows.portfolio?.id;
      if (bPortfolio === undefined) throw new Error('two-tenant portfolio seed rows missing');
      await run({ ...seeded, tx, aPortfolioId, bPortfolioId: bPortfolio });
    });
  });
});
