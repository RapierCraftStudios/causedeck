// Usage rows on the worker database (#223): the e2e seed meters nothing, so the usage specs insert
// `usage_counter` rows for the current IST month here, as the superuser (RLS does not apply), and
// pin the AI budget with a `budget_override` so percentages do not depend on the seeded plan. Every
// test starts from the reset seed, so nothing leaks between tests.
import postgres from 'postgres';

import { e2eUser, E2E_WORKSPACES, type E2eWorkspaceSlug } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';

/** ₹175.00: the pinned monthly AI budget. */
export const AI_BUDGET_PAISE = 17_500;

/** ₹140.00 of ₹175.00 (80%: the warning level), plus tokens, OCR, transcription and storage. */
export const COUNTERS: Readonly<Record<string, number>> = {
  'ai.spend_paise': 14_000,
  'ai.tokens_in': 120_000,
  'ai.tokens_out': 8_000,
  'ocr.pages': 3,
  'stt.seconds': 600,
  'storage.bytes': 5 * 1024 * 1024,
};

async function withSql(database: string, fn: (sql: postgres.Sql) => Promise<unknown>) {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await fn(sql);
  } finally {
    await sql.end();
  }
}

/** This IST month's counters for `slug`, and the AI budget pinned to `AI_BUDGET_PAISE`. */
export function seedUsage(
  database: string,
  slug: E2eWorkspaceSlug,
  counters: Readonly<Record<string, number>> = COUNTERS,
  aiBudgetPaise: number | null = AI_BUDGET_PAISE,
): Promise<void> {
  const workspaceId = E2E_WORKSPACES[slug].id;
  return withSql(database, async (sql) => {
    for (const [key, value] of Object.entries(counters)) {
      await sql`
        insert into usage_counter (workspace_id, key, period_start, value)
        values (${workspaceId}, ${key},
          date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata',
          ${value})
        on conflict (workspace_id, key, period_start) do update set value = excluded.value`;
    }
    if (aiBudgetPaise !== null) await pinAiBudget(sql, slug, aiBudgetPaise);
  });
}

async function pinAiBudget(sql: postgres.Sql, slug: E2eWorkspaceSlug, limitPaise: number) {
  await sql`
    insert into budget_override (workspace_id, key, limit_value, set_by, reason, expires_at)
    values (${E2E_WORKSPACES[slug].id}, 'ai.spend_paise', ${limitPaise}, ${e2eUser('owner', slug).id},
      'e2e: pinned AI budget', now() + interval '1 day')`;
}
