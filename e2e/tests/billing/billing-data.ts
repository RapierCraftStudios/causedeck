// Billing rows on the worker database (#256): the e2e seed gives every workspace an active
// `chamber-seat-1` subscription (10 seats, 4 clerk seats) and no invoices, so the billing specs set
// period dates, statuses and SaaS invoices here, as the superuser (RLS does not apply). Every test
// starts from the reset seed, so nothing leaks between tests.
import postgres from 'postgres';

import { E2E_WORKSPACES, type E2eWorkspaceSlug } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';

const PARTY = { legalName: 'CauseDeck (TEST)', address: 'Chennai', gstin: null, stateCode: '33' };

export interface SeedInvoice {
  number: string;
  issueDate: string;
  status: 'issued' | 'paid' | 'void';
  totalPaise: number;
  /** A rendered PDF (the download link shows); otherwise the cell says `Preparing`. */
  pdf: boolean;
}

/** Two invoices: a paid one with its PDF, and a newer issued one still rendering. */
export const INVOICES: readonly SeedInvoice[] = [
  {
    number: 'CD/25-26/000001',
    issueDate: '2026-02-12',
    status: 'paid',
    totalPaise: 682_748,
    pdf: true,
  },
  {
    number: 'CD/25-26/000002',
    issueDate: '2026-03-12',
    status: 'issued',
    totalPaise: 12_345_678,
    pdf: false,
  },
];

async function withSql(database: string, fn: (sql: postgres.Sql) => Promise<unknown>) {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Renewal on 12 Apr 2026 (IST) and the given invoices for `slug`. */
export function seedBilling(
  database: string,
  slug: E2eWorkspaceSlug,
  invoices: readonly SeedInvoice[] = INVOICES,
): Promise<void> {
  const workspaceId = E2E_WORKSPACES[slug].id;
  return withSql(database, async (sql) => {
    await sql`
      update subscription
      set current_period_start = '2026-03-12T00:00:00+05:30',
          current_period_end = '2026-04-12T00:00:00+05:30'
      where workspace_id = ${workspaceId}`;
    for (const invoice of invoices) {
      await sql`
        insert into saas_invoice (workspace_id, number, series, fy, status, issue_date, supplier,
          recipient, place_of_supply_state_code, taxable_paise, total_paise, pdf_blob_id)
        values (${workspaceId}, ${invoice.number}, 'CD', '25-26', ${invoice.status},
          ${invoice.issueDate}, ${sql.json(PARTY)}, ${sql.json(PARTY)}, '33',
          ${invoice.totalPaise}, ${invoice.totalPaise},
          ${invoice.pdf ? `blob-${invoice.number}` : null})`;
    }
  });
}

/** A failed payment in its grace period, `days` days from now. */
export function setGrace(database: string, slug: E2eWorkspaceSlug, days = 3): Promise<void> {
  const workspaceId = E2E_WORKSPACES[slug].id;
  return withSql(database, async (sql) => {
    await sql`
      update subscription
      set status = 'past_due', dunning_started_at = now(), dunning_attempts = 1,
          grace_until = now() + make_interval(days => ${days})
      where workspace_id = ${workspaceId}`;
  });
}

/** Back on the free Junior plan: the paid subscription was downgraded (`expired`). */
export function downgradeToJunior(database: string, slug: E2eWorkspaceSlug): Promise<void> {
  const workspaceId = E2E_WORKSPACES[slug].id;
  return withSql(database, async (sql) => {
    await sql`update subscription set status = 'expired' where workspace_id = ${workspaceId}`;
  });
}
