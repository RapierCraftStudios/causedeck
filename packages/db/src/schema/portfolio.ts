// Institution portfolios (#661, part 1 of #498, D-048 B2B): `portfolio` is a bank, NBFC or ARC's
// set of tracked recovery cases, `portfolio_case` is one tracked case (a proceeding, or a CNR or
// case number at a source) with its last known status, next date and last adverse order, and
// `portfolio_panel_advocate` delegates an advocate user for the institution's lookups. Tenant tables
// under FORCE RLS via `tenantTable()`; composite FKs keep every row inside its workspace and make
// children die with their portfolio.
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';
import { CNR_PATTERN, proceeding } from './proceedings.ts';
import { source } from './source-registry.ts';

export const portfolio = tenantTable(
  'portfolio',
  {
    id: id(),
    name: text('name').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('portfolio_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('portfolio_workspace_name_uq').on(t.workspaceId, t.name),
    foreignKey({
      name: 'portfolio_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('portfolio_name_chk', sql`char_length(name) between 1 and 200`),
  ],
);

export const portfolioCase = tenantTable(
  'portfolio_case',
  {
    id: id(),
    portfolioId: uuid('portfolio_id').notNull(),
    /** The tracked proceeding when it is already in the workspace; null for a bare CNR or number. */
    proceedingId: uuid('proceeding_id'),
    cnr: text('cnr'),
    caseNumber: text('case_number'),
    sourceId: text('source_id').references(() => source.id, { onDelete: 'restrict' }),
    /** Free-text stage as the source prints it (e.g. "Arguments"). */
    status: text('status'),
    statusCheckedAt: timestamp('status_checked_at', { withTimezone: true }),
    nextDate: date('next_date'),
    lastAdverseOrderAt: timestamp('last_adverse_order_at', { withTimezone: true }),
    lastAdverseOrderRef: text('last_adverse_order_ref'),
    ...timestamps(),
  },
  (t) => [
    unique('portfolio_case_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('portfolio_case_portfolio_cnr_uq').on(t.workspaceId, t.portfolioId, t.cnr),
    foreignKey({
      name: 'portfolio_case_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'portfolio_case_portfolio_fk',
      columns: [t.workspaceId, t.portfolioId],
      foreignColumns: [portfolio.workspaceId, portfolio.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'portfolio_case_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }).onDelete('set null'),
    check('portfolio_case_cnr_chk', sql`cnr is null or cnr ~ ${sql.raw(`'${CNR_PATTERN}'`)}`),
    check(
      'portfolio_case_target_chk',
      sql`proceeding_id is not null or cnr is not null or case_number is not null`,
    ),
  ],
);

export const portfolioPanelAdvocate = tenantTable(
  'portfolio_panel_advocate',
  {
    id: id(),
    portfolioId: uuid('portfolio_id').notNull(),
    /** The advocate whose access the institution's lookups are delegated through. */
    advocateUserId: uuid('advocate_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('portfolio_panel_advocate_uq').on(t.workspaceId, t.portfolioId, t.advocateUserId),
    foreignKey({
      name: 'portfolio_panel_advocate_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'portfolio_panel_advocate_portfolio_fk',
      columns: [t.workspaceId, t.portfolioId],
      foreignColumns: [portfolio.workspaceId, portfolio.id],
    }).onDelete('cascade'),
  ],
);
