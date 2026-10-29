// Fees and invoices e2e data (#872, part 5 of #83). The page is behind the legal-gated flag
// `invoices.enabled` (off by default), so a spec turns it on for the matters workspace
// (`chennai-solo`) and seeds fictional records on the journey matter and its client: a proposed fee
// agreement, a draft invoice, a final invoice and the client's ledger rows. Rows go straight into
// the worker database as the superuser, as the other product helpers do. No Playwright imports.
import postgres from 'postgres';

import { databaseUrl } from '../support/db-reset.ts';

import { COURTS_WORKSPACE_ID } from './courts-data.ts';
import { MATTER_PEOPLE, MATTERS } from './matters-data.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const CLIENT = MATTER_PEOPLE.find((p) => p.kind === 'client');
if (CLIENT === undefined) throw new Error('e2e: the matters fixture has no client');

export const FEES = {
  matter: MATTERS.appeal,
  client: CLIENT,
  /** A proposed (draft) fixed-fee agreement: Rs 1,23,456.00. */
  agreement: {
    id: uuid(0x87201),
    amountPaise: 12345600,
    startsOn: '2026-04-01',
  },
  /** A draft invoice: 2 x Rs 5,000.00 forward charge. */
  draft: {
    id: uuid(0x87202),
    line: 'Appearance, fictional matter',
  },
  /** A final invoice: Rs 11,800.00 with a Rs 5,000.00 receipt, so Rs 6,800.00 is owed. */
  issued: {
    id: uuid(0x87203),
    number: 'FE/26-27/000001',
    totalPaise: 1180000,
  },
  ledger: {
    feeId: uuid(0x87204),
    receiptId: uuid(0x87205),
    receiptNote: 'Cheque received (fictional)',
  },
  /** The supplier's state, and a place of supply in the same state (so CGST and SGST). */
  stateCode: '33',
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
 * Turn `invoices.enabled` on for the matters workspace. It is legal-gated: on only when the global
 * row and the workspace row are both on and carry `legal_ack_by` and a note. The insert fires
 * `flag_changed`, which empties the server's flag cache.
 */
export function enableFees(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`
      insert into feature_flag (key, enabled, updated_by, legal_ack_by, legal_ack_note)
      select 'invoices.enabled', true, m.user_id, m.user_id,
             'e2e fixture: counsel sign-off recorded (fictional)'
        from member m
       where m.workspace_id = ${COURTS_WORKSPACE_ID} and m.role = 'owner'
       limit 1
      on conflict (key) do update set enabled = true, legal_ack_by = excluded.legal_ack_by,
        legal_ack_note = excluded.legal_ack_note`;
    await sql`
      insert into workspace_feature_flag
        (workspace_id, key, enabled, updated_by, legal_ack_by, legal_ack_note)
      select ${COURTS_WORKSPACE_ID}, 'invoices.enabled', true, m.user_id, m.user_id,
             'e2e fixture: counsel sign-off recorded (fictional)'
        from member m
       where m.workspace_id = ${COURTS_WORKSPACE_ID} and m.role = 'owner'
       limit 1
      on conflict do nothing`;
  });
}

export interface SeedFeesOptions {
  /** Insert the proposed agreement (default true). */
  agreement?: boolean;
  /** Insert the draft invoice (default true). */
  draft?: boolean;
  /** Insert the final invoice and the client's ledger rows (default true). */
  issued?: boolean;
}

/** Seed the fee records; each part can be left out to reach the empty states. */
export function seedFees(
  database: string,
  { agreement = true, draft = true, issued = true }: SeedFeesOptions = {},
): Promise<void> {
  const F = FEES;
  return withSql(database, async (sql) => {
    const ws = COURTS_WORKSPACE_ID;
    if (agreement) {
      await sql`
        insert into fee_agreement
          (id, workspace_id, matter_id, person_id, basis, amount_paise, gst_treatment, status,
           starts_on, notes)
        values
          (${F.agreement.id}, ${ws}, ${F.matter.id}, ${F.client.id}, 'fixed',
           ${F.agreement.amountPaise}, 'forward_charge', 'draft', ${F.agreement.startsOn},
           'Fictional terms')`;
    }
    if (draft) {
      await sql`
        insert into fee_invoice
          (id, workspace_id, matter_id, person_id, status, place_of_supply_state_code,
           taxable_paise, tax_paise, total_paise)
        values
          (${F.draft.id}, ${ws}, ${F.matter.id}, ${F.client.id}, 'draft', ${F.stateCode},
           1000000, 180000, 1180000)`;
      await sql`
        insert into fee_invoice_line
          (workspace_id, invoice_id, position, description, quantity, unit_price_paise,
           amount_paise, gst_treatment)
        values
          (${ws}, ${F.draft.id}, 0, ${F.draft.line}, 2, 500000, 1000000, 'forward_charge')`;
    }
    if (issued) {
      await sql`
        insert into fee_invoice
          (id, workspace_id, matter_id, person_id, number, status, issue_date,
           place_of_supply_state_code, taxable_paise, tax_paise, total_paise)
        values
          (${F.issued.id}, ${ws}, ${F.matter.id}, ${F.client.id}, ${F.issued.number}, 'issued',
           '2026-05-01', ${F.stateCode}, 1000000, 180000, ${F.issued.totalPaise})`;
      await sql`
        insert into fee_invoice_line
          (workspace_id, invoice_id, position, description, quantity, unit_price_paise,
           amount_paise, gst_treatment)
        values
          (${ws}, ${F.issued.id}, 0, 'Drafting, fictional matter', 1, 1000000, 1000000,
           'forward_charge')`;
      await sql`
        insert into client_ledger_entry
          (id, workspace_id, person_id, matter_id, invoice_id, kind, direction, amount_paise,
           description, occurred_on)
        values
          (${F.ledger.feeId}, ${ws}, ${F.client.id}, ${F.matter.id}, ${F.issued.id}, 'fee',
           'debit', ${F.issued.totalPaise}, ${`Invoice ${F.issued.number}`}, '2026-05-01'),
          (${F.ledger.receiptId}, ${ws}, ${F.client.id}, ${F.matter.id}, ${F.issued.id},
           'receipt', 'credit', 500000, ${F.ledger.receiptNote}, '2026-05-09')`;
    }
  });
}
