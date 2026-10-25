// Institution portfolio data model (#661): shape of the three tenant tables and the institution kind.
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { WORKSPACE_KINDS } from '../schema/auth.ts';
import { portfolio, portfolioCase, portfolioPanelAdvocate } from '../schema/portfolio.ts';

const names = (t: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(t).checks.map((c) => c.name);

describe('portfolio schema (#661)', () => {
  it('adds the institution workspace kind', () => {
    expect(WORKSPACE_KINDS).toContain('institution');
  });

  it('declares workspace-scoped tables with a workspace_id column', () => {
    for (const t of [portfolio, portfolioCase, portfolioPanelAdvocate]) {
      expect(t.workspaceId.notNull).toBe(true);
    }
  });

  it('checks CNR format and requires a target on a tracked case', () => {
    expect(names(portfolioCase)).toEqual(['portfolio_case_cnr_chk', 'portfolio_case_target_chk']);
  });

  it('keeps a case and a panel advocate inside their portfolio and workspace', () => {
    for (const t of [portfolioCase, portfolioPanelAdvocate]) {
      const fks = getTableConfig(t).foreignKeys.map((f) => f.getName());
      expect(fks.some((n) => n.endsWith('_portfolio_fk'))).toBe(true);
    }
    expect(getTableConfig(portfolioPanelAdvocate).uniqueConstraints.map((u) => u.name)).toContain(
      'portfolio_panel_advocate_uq',
    );
  });
});
