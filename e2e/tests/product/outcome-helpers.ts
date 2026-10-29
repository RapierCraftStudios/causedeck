// Shared seed and helpers for the hearing outcome specs (#62): a hearing with the voice job's
// proposals (an anchored next date and three directions), a hearing with none (manual), and a
// counter of the actions a happy-path confirmation takes.
import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import type { AsUser } from '../../fixtures/auth.ts';
import { COURTS_WORKSPACE_ID } from '../../fixtures/courts-data.ts';
import { MATTERS, MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { expect, type E2eRole } from '../../fixtures/index.ts';
import { e2eUser } from '../../fixtures/workspace.ts';
import { withSql } from '../lifecycle/helpers.ts';

const matter = MATTERS.appeal;
const proceeding = matter.proceedings[0];
export const HELD_ON = '2026-03-10';

// Next dates sit in 2099 like the matters fixtures: the server confirms a next date against its real
// clock and refuses a past one, so a date near the held-on date stops working once it has passed.
export const PROPOSED_ISO = '2099-04-10';
export const PROPOSED_DATE = '10/04/2099';
/** A date a lawyer types on the manual path, `dd/mm/yyyy`. */
export const TYPED_DATE = '15/04/2099';

export interface SeededHearing {
  hearingId: string;
}

/** A hearing on the main proceeding; `proposals` stages the voice job's drafts for it. */
export async function seedHearing(
  database: string,
  opts: {
    proposals: boolean;
    conflict?: boolean;
    delegateTo?: E2eRole;
    /** This role's member argued the hearing: the preparedness tap (#86) saves against it. */
    appearedAs?: E2eRole;
  },
): Promise<SeededHearing> {
  const ws = COURTS_WORKSPACE_ID;
  return withSql(database, async (sql) => {
    const listingId = randomUUID();
    const hearingId = randomUUID();
    await sql`
      insert into listing (id, workspace_id, proceeding_id, list_date, list_type, stage_raw, canonical,
        source_type, confirmation_state)
      values (${listingId}, ${ws}, ${proceeding.id}, ${HELD_ON}, 'daily', 'For hearing', false,
              'manual', 'confirmed')`;
    await sql`
      insert into hearing (id, workspace_id, listing_id, held_on, source_type)
      values (${hearingId}, ${ws}, ${listingId}, ${HELD_ON}, 'manual')`;
    // The fixture's appeal matter already has a confirmed canonical next date (2099-03-02), and a
    // proceeding may hold only one (`listing_one_canonical_uq`). That date is the conflict: the
    // proposed date differs from it. Without `conflict`, drop the flag so a proposed or typed
    // date is a plain choice and Confirm is not gated on a conflict the test never asked for.
    if (opts.conflict !== true) {
      await sql`
        update listing set canonical = false
        where workspace_id = ${ws} and proceeding_id = ${proceeding.id} and canonical`;
    }
    if (opts.delegateTo !== undefined) {
      // A delegated appearance (#63): the member appears for the lawyer, which is what lets a
      // junior read and confirm this matter's outcome.
      const [found] = await sql<{ id: string }[]>`
        select id from member where workspace_id = ${ws} and user_id = ${e2eUser(opts.delegateTo).id}`;
      if (found === undefined)
        throw new Error(`e2e: no ${opts.delegateTo} member in the workspace`);
      await sql`
        insert into appearance (workspace_id, hearing_id, member_id, capacity)
        values (${ws}, ${hearingId}, ${found.id}, 'for_other')`;
    }
    if (opts.appearedAs !== undefined) {
      const [found] = await sql<{ id: string }[]>`
        select id from member where workspace_id = ${ws} and user_id = ${e2eUser(opts.appearedAs).id}`;
      if (found === undefined)
        throw new Error(`e2e: no ${opts.appearedAs} member in the workspace`);
      await sql`
        insert into appearance (workspace_id, hearing_id, member_id, capacity)
        values (${ws}, ${hearingId}, ${found.id}, 'arguing')`;
    }
    if (opts.proposals) {
      const documentId = randomUUID();
      const anchorId = randomUUID();
      await sql`
        insert into document (id, workspace_id, matter_id, kind, storage_key, sha256, language)
        values (${documentId}, ${ws}, ${matter.id}, 'note', ${`e2e/${documentId}.json`},
                ${documentId.replaceAll('-', '').padEnd(64, '0')}, 'en')`;
      await sql`
        insert into anchor (id, workspace_id, document_id, page_no, quote, kind)
        values (${anchorId}, ${ws}, ${documentId}, 1, 'Adjourned to 10 April for reply.', 'transcript')`;
      const draft = async (kind: string, payload: Record<string, unknown>) => {
        await sql`
          insert into proposal (id, workspace_id, kind, level, payload, anchors, matter_id, proceeding_id,
            idempotency_key)
          values (${randomUUID()}, ${ws}, ${kind}, 'L2', ${sql.json(payload as never)},
                  ${sql.json([anchorId])}, ${matter.id}, ${proceeding.id}, ${randomUUID()})`;
      };
      await draft('hearing_outcome', { hearingDate: HELD_ON, outcome: 'Adjourned for reply' });
      await draft('next_date', { date: PROPOSED_ISO });
      for (const description of ['File reply', 'Serve the respondent', 'Produce the lease']) {
        await draft('obligation_from_direction', {
          hearingDate: HELD_ON,
          description,
          dueDate: '2026-03-24',
          matterId: matter.id,
        });
      }
    }
    return { hearingId };
  });
}

export async function openOutcome(
  page: Page,
  asUser: AsUser,
  hearingId: string,
  { role = 'owner', query = '' }: { role?: E2eRole; query?: string } = {},
): Promise<void> {
  await asUser(role, {
    workspace: MATTERS_WORKSPACE,
    path: `hearings/${hearingId}/outcome${query}`,
  });
  await expect(page.locator('main')).toBeVisible();
}

/** Counts the keyboard actions (key presses) and taps (clicks) a flow makes. */
export class StepCounter {
  keys = 0;
  taps = 0;
  constructor(private readonly page: Page) {}

  async press(key: string): Promise<void> {
    this.keys += 1;
    await this.page.keyboard.press(key);
  }

  async tap(target: ReturnType<Page['getByRole']>): Promise<void> {
    this.taps += 1;
    await target.click();
  }
}
