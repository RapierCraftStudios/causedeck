// Seeds for the outward drafts journeys (#737). The e2e stack has no AI or job worker, so drafts
// are inserted straight into the worker database as `composeUpdate` and `saveEdit` would leave
// them (see import-helpers.ts for the same approach). Fictional data only.
import postgres from 'postgres';

import { MATTERS } from '../../fixtures/matters-data.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { SHELL_WORKSPACE } from '../shell/helpers.ts';

export const DRAFTS_PATH = 'drafts';

export type DraftKind = 'client' | 'edited' | 'shared' | 'tamil' | 'kannada';

export interface SeededDrafts {
  client: string;
  edited: string;
  shared: string;
  tamil: string;
  kannada: string;
}

export const CLIENT_TEXT =
  'Dear Mr Ramaswamy, your matter was heard today. The next date is 12 March 2026. The wording is for you to review.';
export const EDITED_SYSTEM_TEXT = 'The hearing was adjourned. Next date to be confirmed.';
export const EDITED_TEXT = 'The hearing was adjourned. Next date: 19 March 2026.';
const TAMIL_TEXT = 'உங்கள் வழக்கு இன்று விசாரிக்கப்பட்டது. அடுத்த தேதி 12 மார்ச் 2026.';
const KANNADA_TEXT = 'ನಿಮ್ಮ ಪ್ರಕರಣವನ್ನು ಇಂದು ವಿಚಾರಣೆ ಮಾಡಲಾಯಿತು. ಮುಂದಿನ ದಿನಾಂಕ 12 ಮಾರ್ಚ್ 2026.';

const fact = (hearingId: string, confirmed: boolean) => ({
  kind: 'next_date',
  text: confirmed ? 'Next date 12 March 2026' : 'Next date to be confirmed',
  confirmed,
  provenance: {
    table: 'hearing',
    recordId: hearingId,
    sourceType: 'manual',
    sourceRef: null,
    anchorId: null,
    confirmationState: confirmed ? 'confirmed' : 'proposed',
  },
});

/** Insert one draft per kind in the shell workspace; resolves to their ids. */
export async function seedDrafts(database: string): Promise<SeededDrafts> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    const [owner] = await sql<{ workspace_id: string; user_id: string }[]>`
      select o.id as workspace_id, m.user_id
        from organization o
        join member m on m.workspace_id = o.id and m.role = 'owner'
       where o.slug = ${SHELL_WORKSPACE}
       limit 1`;
    if (owner === undefined) throw new Error('outward seed: the shell workspace has no owner');
    const ws = owner.workspace_id;
    // A client draft must name its client (outward_draft_client_chk), as composeUpdate requires.
    const [existingClient] = await sql<{ id: string }[]>`
      select id from person where workspace_id = ${ws} and kind = 'client' order by id limit 1`;
    let clientPersonId = existingClient?.id;
    if (clientPersonId === undefined) {
      const [created] = await sql<{ id: string }[]>`
        insert into person (workspace_id, name, aliases, kind, source_type, confirmation_state)
        values (${ws}, 'S. Ramaswamy (fictional)', '{}'::text[], 'client', 'manual', 'confirmed')
        returning id`;
      if (created === undefined) throw new Error('outward seed: client person insert failed');
      clientPersonId = created.id;
    }

    const hearingFor = async (listingId: string): Promise<string> => {
      const [row] = await sql<{ id: string }[]>`
        insert into hearing (workspace_id, listing_id, held_on, source_type, confirmation_state)
        values (${ws}, ${listingId}, '2026-03-12', 'manual', 'confirmed')
        returning id`;
      if (row === undefined) throw new Error('outward seed: hearing insert returned nothing');
      return row.id;
    };
    const draft = async (
      matterId: string,
      hearingId: string,
      language: string,
      audience: string,
      status: string,
      versions: { author: string; body: string; confirmed: boolean }[],
    ): Promise<{ id: string; versionIds: string[] }> => {
      const [d] = await sql<{ id: string }[]>`
        insert into outward_draft (workspace_id, matter_id, hearing_id, audience, language, tone,
          status, client_person_id, created_by)
        values (${ws}, ${matterId}, ${hearingId}, ${audience}, ${language}, 'formal', ${status},
          ${audience === 'client' ? clientPersonId : null}, ${owner.user_id})
        returning id`;
      if (d === undefined) throw new Error('outward seed: draft insert returned nothing');
      const versionIds: string[] = [];
      for (const v of versions) {
        const [row] = await sql<{ id: string }[]>`
          insert into outward_draft_version (workspace_id, draft_id, author, body, facts)
          values (${ws}, ${d.id}, ${v.author === 'system' ? 'system' : owner.user_id}, ${v.body},
            ${sql.json([fact(hearingId, v.confirmed)] as never)})
          returning id`;
        if (row !== undefined) versionIds.push(row.id);
      }
      return { id: d.id, versionIds };
    };

    const english = MATTERS.appeal;
    const listing = (m: { listings: readonly { id: string }[] }) => {
      const first = m.listings[0];
      if (first === undefined) throw new Error('outward seed: matter without a listing');
      return first.id;
    };
    const hearing = await hearingFor(listing(english));
    const client = await draft(english.id, hearing, 'en', 'client', 'drafted', [
      { author: 'system', body: CLIENT_TEXT, confirmed: true },
    ]);
    const edited = await draft(
      MATTERS.conflict.id,
      await hearingFor(listing(MATTERS.conflict)),
      'en',
      'senior_counsel',
      'edited',
      [
        { author: 'system', body: EDITED_SYSTEM_TEXT, confirmed: false },
        { author: 'member', body: EDITED_TEXT, confirmed: true },
      ],
    );
    const shared = await draft(
      MATTERS.proposed.id,
      await hearingFor(listing(MATTERS.proposed)),
      'en',
      'briefing_counsel',
      'shared',
      [{ author: 'system', body: CLIENT_TEXT, confirmed: true }],
    );
    const sharedVersion = shared.versionIds[0];
    if (sharedVersion === undefined) throw new Error('outward seed: shared draft has no version');
    await sql`
      insert into outward_share_log (workspace_id, draft_id, member_id, channel, final_version_id)
      values (${ws}, ${shared.id}, ${owner.user_id}, 'clipboard', ${sharedVersion})`;
    const tamil = await draft(
      MATTERS.tamil.id,
      await hearingFor(listing(MATTERS.tamil)),
      'ta',
      'client',
      'drafted',
      [{ author: 'system', body: TAMIL_TEXT, confirmed: true }],
    );
    const kannada = await draft(
      MATTERS.kannada.id,
      await hearingFor(listing(MATTERS.kannada)),
      'kn',
      'client',
      'drafted',
      [{ author: 'system', body: KANNADA_TEXT, confirmed: true }],
    );
    return {
      client: client.id,
      edited: edited.id,
      shared: shared.id,
      tamil: tamil.id,
      kannada: kannada.id,
    };
  } finally {
    await sql.end();
  }
}

/** How many shares the lawyer has recorded for a draft (the only write a hand-off makes). */
export async function shareCount(database: string, draftId: string): Promise<number> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from outward_share_log where draft_id = ${draftId}`;
    return row?.n ?? 0;
  } finally {
    await sql.end();
  }
}
