// Limitation tracker e2e data (#942, part 4 of #84). The tracker is behind the legal-gated flag
// `limitation.enabled` (off by default), so a spec turns it on for the matters workspace
// (`chennai-solo`) and seeds a SYNTHETIC rule table: fictional codes and periods, marked reviewed
// so the engine will use them, plus one rule left as a draft (never offered or computed). Rows go
// straight into the worker database as the superuser, as the other product helpers do. No
// Playwright imports.
import postgres from 'postgres';

import { databaseUrl } from '../support/db-reset.ts';

import { COURTS_WORKSPACE_ID } from './courts-data.ts';
import { MATTER_PEOPLE, MATTERS } from './matters-data.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const LIMITATION = {
  version: 'SYNTHETIC-1',
  /** A reviewed rule: 3 years from the cause of action. */
  suit: {
    id: uuid(0x94201),
    code: 'synthetic.suit_recovery',
    title: 'Synthetic suit for recovery',
  },
  /** A reviewed rule: 30 days from the order date. */
  appeal: {
    id: uuid(0x94202),
    code: 'synthetic.appeal_order',
    title: 'Synthetic appeal from an order',
  },
  /** Imported but not reviewed: listed as a draft, never offered for a computation. */
  draft: {
    id: uuid(0x94203),
    code: 'synthetic.draft_notice',
    title: 'Synthetic draft notice period',
  },
  /** A proposed computation on the appeal matter, seeded so the list has a card to confirm. */
  computation: {
    id: uuid(0x94210),
    startDate: '2026-01-10',
    expiresOn: '2029-01-09',
  },
  matter: MATTERS.appeal,
} as const;

async function withSql<T>(database: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/**
 * Turn a legal-gated flag on for the matters workspace. It is on only when the global row and the
 * workspace row are both on and carry `legal_ack_by` and a note. The insert fires `flag_changed`,
 * which empties the server's flag cache.
 */
export function enableLegalGatedFlag(database: string, key: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`
      insert into feature_flag (key, enabled, updated_by, legal_ack_by, legal_ack_note)
      select ${key}, true, m.user_id, m.user_id,
             'e2e fixture: counsel sign-off recorded (fictional)'
        from member m
       where m.workspace_id = ${COURTS_WORKSPACE_ID} and m.role = 'owner'
       limit 1
      on conflict (key) do update set enabled = true, legal_ack_by = excluded.legal_ack_by,
        legal_ack_note = excluded.legal_ack_note`;
    await sql`
      insert into workspace_feature_flag
        (workspace_id, key, enabled, updated_by, legal_ack_by, legal_ack_note)
      select ${COURTS_WORKSPACE_ID}, ${key}, true, m.user_id, m.user_id,
             'e2e fixture: counsel sign-off recorded (fictional)'
        from member m
       where m.workspace_id = ${COURTS_WORKSPACE_ID} and m.role = 'owner'
       limit 1
      on conflict do nothing`;
  });
}

/** Turn `limitation.enabled` on for the matters workspace. */
export function enableLimitation(database: string): Promise<void> {
  return enableLegalGatedFlag(database, 'limitation.enabled');
}

/** Turn `status_links.enabled` on for the matters workspace. */
export function enableStatusLinks(database: string): Promise<void> {
  return enableLegalGatedFlag(database, 'status_links.enabled');
}

/** A reachable contact for the seeded client of the main matter, so a status link can be made. */
export function seedClientContact(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`
      insert into client_contact (workspace_id, person_id, kind, email, language_pref)
      values (${COURTS_WORKSPACE_ID}, ${MATTER_PEOPLE[0]?.id ?? ''}, 'primary',
              'ramaswamy@example.e2e.test', 'en')
      on conflict do nothing`;
  });
}

export interface SeedLimitationOptions {
  /** Insert the reviewed rules (default true); false leaves only the draft, the no-rules state. */
  reviewed?: boolean;
  /** Insert a proposed computation on the appeal matter (default true). */
  computation?: boolean;
  /** The seeded computation's status (default proposed); a viewer sees confirmed ones only. */
  status?: 'proposed' | 'confirmed';
}

/** Seed the synthetic rule table (reviewed rules and one draft) and, optionally, a proposal. */
export function seedLimitation(
  database: string,
  { reviewed = true, computation = true, status = 'proposed' }: SeedLimitationOptions = {},
): Promise<void> {
  const L = LIMITATION;
  return withSql(database, async (sql) => {
    const ws = COURTS_WORKSPACE_ID;
    if (reviewed) {
      await sql`
        insert into limitation_rule
          (id, workspace_id, code, title, statute, period_value, period_unit, start_event,
           condonable, citation, reviewed, reviewed_at, table_version)
        values
          (${L.suit.id}, ${ws}, ${L.suit.code}, ${L.suit.title}, 'Fictional Limitation Code, Schedule A',
           3, 'years', 'cause_of_action', true, 'Fictional Code s. 1(a)', true, now(), ${L.version}),
          (${L.appeal.id}, ${ws}, ${L.appeal.code}, ${L.appeal.title}, 'Fictional Limitation Code, Schedule B',
           30, 'days', 'order_date', false, null, true, now(), ${L.version})`;
    }
    await sql`
      insert into limitation_rule
        (id, workspace_id, code, title, statute, period_value, period_unit, start_event,
         condonable, citation, reviewed, reviewed_at, table_version)
      values
        (${L.draft.id}, ${ws}, ${L.draft.code}, ${L.draft.title}, 'Fictional Limitation Code, Schedule C',
         6, 'months', 'knowledge', true, null, false, null, ${L.version})`;
    if (reviewed && computation) {
      const input = {
        matterId: L.matter.id,
        ruleCode: L.suit.code,
        startDate: L.computation.startDate,
        excludedDays: 0,
        ruleId: L.suit.id,
        ruleVersion: L.version,
      };
      const result = {
        ruleCode: L.suit.code,
        startDate: L.computation.startDate,
        expiresOn: L.computation.expiresOn,
        status,
        notes: ['Delay may be condoned on application.'],
      };
      await sql`
        insert into limitation_computation
          (id, workspace_id, matter_id, rule_id, input, result, start_date, expires_on, status)
        values
          (${L.computation.id}, ${ws}, ${L.matter.id}, ${L.suit.id}, ${sql.json(input)},
           ${sql.json(result)}, ${L.computation.startDate}, ${L.computation.expiresOn}, ${status})`;
    }
  });
}
