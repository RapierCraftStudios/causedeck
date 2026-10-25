// Matters e2e fixture data (#394), shared by support/db-reset.ts (which seeds it into the template
// as the owner role, inside the workspace-scoped transaction of `seedCourtFixtures`) and the matters
// specs. No Playwright or workspace-package imports: support/server-pool.ts loads db-reset.ts with
// plain `node --experimental-strip-types`.
//
// Two sets, all in `chennai-solo` and all fictional: the journey matters below (an appeal chain with
// W.M.P. children, a date conflict, a proposed next date, a sensitive matter, Tamil and Kannada
// party names) and a bulk of PERF_MATTERS matters with PERF_PROCEEDINGS_PER_MATTER proceedings each
// (500 matters, 1,500 proceedings: the list budget of #40). The bulk has no next date, so the
// default sort (next date, nulls last) puts the journey matters first and the first page is stable.
// Next dates sit in 2099 so they stay in the future of the real server clock the page reads.
import type postgres from 'postgres';

import { COURTS_WORKSPACE_ID, HALLS_FORUM } from './courts-data.ts';

export const MATTERS_WORKSPACE = 'chennai-solo';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export interface MatterProceedingFixture {
  id: string;
  caseTypeCode: string;
  number: string;
  year: number;
  kind: 'main' | 'misc' | 'appeal' | 'connected';
  state: 'filed' | 'numbered' | 'disposed';
  /** Index into the matter's proceedings of the parent (a W.M.P. under its W.P., a W.A. under it). */
  parent?: number;
  titlePetitioner?: string;
  titleRespondent?: string;
}

export interface MatterListingFixture {
  id: string;
  /** Index into the matter's proceedings. */
  proceeding: number;
  date: string;
  canonical: boolean;
  confirmationState: 'confirmed' | 'proposed';
}

export interface MatterFixture {
  id: string;
  title: string;
  sensitive: boolean;
  synopsis: string | null;
  proceedings: readonly MatterProceedingFixture[];
  listings: readonly MatterListingFixture[];
}

export const MATTERS = {
  /** W.P. with its W.A. (appeal) and two W.M.P.s (misc): the appeal chain and children. */
  appeal: {
    id: uuid(0xb0001),
    title: 'Ramaswamy v. State of Tamil Nadu (fictional)',
    sensitive: false,
    synopsis: 'Challenge to a fictional land-use order; appeal pending.',
    proceedings: [
      {
        id: uuid(0xc0001),
        caseTypeCode: 'WP',
        number: '3001',
        year: 2024,
        kind: 'main',
        state: 'numbered',
        titlePetitioner: 'S. Ramaswamy',
        titleRespondent: 'State of Tamil Nadu',
      },
      {
        id: uuid(0xc0002),
        caseTypeCode: 'WA',
        number: '210',
        year: 2025,
        kind: 'appeal',
        state: 'numbered',
        parent: 0,
        titlePetitioner: 'State of Tamil Nadu',
        titleRespondent: 'S. Ramaswamy',
      },
      {
        id: uuid(0xc0003),
        caseTypeCode: 'WMP',
        number: '4501',
        year: 2024,
        kind: 'misc',
        state: 'numbered',
        parent: 0,
      },
      {
        id: uuid(0xc0004),
        caseTypeCode: 'WMP',
        number: '4502',
        year: 2024,
        kind: 'misc',
        state: 'numbered',
        parent: 0,
      },
    ],
    listings: [
      {
        id: uuid(0xd0001),
        proceeding: 0,
        date: '2099-03-02',
        canonical: true,
        confirmationState: 'confirmed',
      },
    ],
  },
  /** A canonical next date and a different proposed one: the conflict card. */
  conflict: {
    id: uuid(0xb0002),
    title: 'Meenakshi v. Kannan (fictional)',
    sensitive: false,
    synopsis: null,
    proceedings: [
      {
        id: uuid(0xc0011),
        caseTypeCode: 'WP',
        number: '3002',
        year: 2025,
        kind: 'main',
        state: 'numbered',
        titlePetitioner: 'Meenakshi',
        titleRespondent: 'Kannan',
      },
    ],
    listings: [
      {
        id: uuid(0xd0011),
        proceeding: 0,
        date: '2099-04-10',
        canonical: true,
        confirmationState: 'confirmed',
      },
      {
        id: uuid(0xd0012),
        proceeding: 0,
        date: '2099-05-15',
        canonical: false,
        confirmationState: 'proposed',
      },
    ],
  },
  /** A canonical next date still waiting for a person (`proposed`): the badge and the Confirm button. */
  proposed: {
    id: uuid(0xb0003),
    title: 'Abdul Rahman v. Fictional Municipality',
    sensitive: false,
    synopsis: null,
    proceedings: [
      {
        id: uuid(0xc0021),
        caseTypeCode: 'WP',
        number: '3003',
        year: 2025,
        kind: 'main',
        state: 'numbered',
        titlePetitioner: 'Abdul Rahman',
        titleRespondent: 'Fictional Municipality',
      },
    ],
    listings: [
      {
        id: uuid(0xd0021),
        proceeding: 0,
        date: '2099-06-01',
        canonical: true,
        confirmationState: 'proposed',
      },
    ],
  },
  /** Locked: shows the lock badge in the list and the header. */
  sensitive: {
    id: uuid(0xb0004),
    title: 'Sensitive family matter (fictional)',
    sensitive: true,
    synopsis: 'Kept private; AI processing is off.',
    proceedings: [],
    listings: [],
  },
  /** Tamil party names (Noto Sans Tamil fallback and line height). */
  tamil: {
    id: uuid(0xb0005),
    title: 'முருகன் v. தமிழ்நாடு அரசு (fictional)',
    sensitive: false,
    synopsis: null,
    proceedings: [
      {
        id: uuid(0xc0031),
        caseTypeCode: 'CRP',
        number: '77',
        year: 2025,
        kind: 'main',
        state: 'numbered',
        titlePetitioner: 'முருகன்',
        titleRespondent: 'தமிழ்நாடு அரசு',
      },
    ],
    listings: [
      {
        id: uuid(0xd0031),
        proceeding: 0,
        date: '2099-07-07',
        canonical: true,
        confirmationState: 'confirmed',
      },
    ],
  },
  /** Kannada party names (Noto Sans Kannada fallback and line height). */
  kannada: {
    id: uuid(0xb0006),
    title: 'ಕುಮಾರ್ v. ಕರ್ನಾಟಕ ರಾಜ್ಯ (fictional)',
    sensitive: false,
    synopsis: null,
    proceedings: [
      {
        id: uuid(0xc0041),
        caseTypeCode: 'CRP',
        number: '78',
        year: 2025,
        kind: 'main',
        state: 'numbered',
        titlePetitioner: 'ಕುಮಾರ್',
        titleRespondent: 'ಕರ್ನಾಟಕ ರಾಜ್ಯ',
      },
    ],
    listings: [
      {
        id: uuid(0xd0041),
        proceeding: 0,
        date: '2099-08-08',
        canonical: true,
        confirmationState: 'confirmed',
      },
    ],
  },
} as const satisfies Record<string, MatterFixture>;

export const JOURNEY_MATTERS: readonly MatterFixture[] = Object.values(MATTERS);

/** The matter whose Overview, Proceedings, People and Documents tabs the specs open. */
export const MAIN_MATTER = MATTERS.appeal;

export interface MatterPersonFixture {
  id: string;
  name: string;
  kind: 'client' | 'advocate';
  aliases: readonly string[];
  contact: { email: string } | null;
}

/** People of `MAIN_MATTER`; the client's name is Tamil. */
export const MATTER_PEOPLE: readonly MatterPersonFixture[] = [
  {
    id: uuid(0xe1001),
    name: 'ராமசாமி',
    kind: 'client',
    aliases: ['S. Ramaswamy'],
    contact: { email: 'ramaswamy@example.e2e.test' },
  },
  {
    id: uuid(0xe1002),
    name: 'Advocate Lakshmi (fictional)',
    kind: 'advocate',
    aliases: [],
    contact: null,
  },
];

export const MATTER_DOCUMENT = {
  id: uuid(0xf1001),
  kind: 'pleading',
} as const;

/** The bulk for the list budget: 500 matters with 3 proceedings each. */
export const PERF_MATTERS = 500;
export const PERF_PROCEEDINGS_PER_MATTER = 3;
export const PERF_TITLE_PREFIX = 'Perf matter';

/** The catalogue forum every fixture proceeding is before (system row, seeded by `migrate.ts`). */
export const MATTERS_FORUM_CODE = HALLS_FORUM;

/** Its id. Read it outside the workspace-scoped transaction (`sql` is any connection). */
export async function matterForumId(sql: postgres.Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    select id from forum where workspace_id is null and code = ${MATTERS_FORUM_CODE}`;
  if (row === undefined) throw new Error(`e2e: catalogue forum ${MATTERS_FORUM_CODE} is missing`);
  return row.id;
}

/**
 * Insert the matters fixtures inside the workspace-scoped transaction `tx` (`app.workspace_id` set
 * to the courts workspace), before forum `forum` (see `matterForumId`). Foreign-key order: matters,
 * proceedings, listings, people and their role edges, one document, then the bulk.
 */
export async function seedMatterFixtures(
  tx: postgres.TransactionSql,
  forum: string,
): Promise<void> {
  const ws = COURTS_WORKSPACE_ID;
  for (const m of JOURNEY_MATTERS) {
    await tx`
      insert into matter (id, workspace_id, title, sensitive, synopsis)
      values (${m.id}, ${ws}, ${m.title}, ${m.sensitive}, ${m.synopsis})`;
    for (const p of m.proceedings) {
      await tx`
        insert into proceeding (id, workspace_id, matter_id, forum_id, kind, case_type_code, number,
          year, state, title_petitioner, title_respondent, source_type, confirmation_state)
        values (${p.id}, ${ws}, ${m.id}, ${forum}, ${p.kind}, ${p.caseTypeCode}, ${p.number},
                ${p.year}, ${p.state}, ${p.titlePetitioner ?? null}, ${p.titleRespondent ?? null},
                'manual', 'confirmed')`;
    }
    for (const p of m.proceedings) {
      const parent = 'parent' in p ? m.proceedings[p.parent] : undefined;
      if (parent === undefined) continue;
      await tx`
        update proceeding set parent_proceeding_id = ${parent.id}
        where workspace_id = ${ws} and id = ${p.id}`;
    }
    for (const l of m.listings) {
      const p = m.proceedings[l.proceeding];
      if (p === undefined) throw new Error(`e2e: listing ${l.id} names a missing proceeding`);
      await tx`
        insert into listing (id, workspace_id, proceeding_id, list_date, list_type, stage_raw,
          canonical, source_type, confirmation_state)
        values (${l.id}, ${ws}, ${p.id}, ${l.date}, 'daily', 'For hearing', ${l.canonical},
                'manual', ${l.confirmationState})`;
    }
  }
  for (const person of MATTER_PEOPLE) {
    await tx`
      insert into person (id, workspace_id, name, aliases, kind, contact, source_type,
        confirmation_state)
      values (${person.id}, ${ws}, ${person.name}, ${person.aliases as string[]}::text[],
              ${person.kind}, ${person.contact === null ? null : JSON.stringify(person.contact)}::jsonb,
              'manual', 'confirmed')`;
    await tx`
      insert into role_edge (workspace_id, kind, from_person_id, matter_id, source_type,
        confirmation_state)
      values (${ws}, ${person.kind === 'client' ? 'instructed_by' : 'represents'}, ${person.id},
              ${MAIN_MATTER.id}, 'manual', 'confirmed')`;
  }
  await tx`
    insert into document (id, workspace_id, kind, storage_key, sha256, text_status, matter_id)
    values (${MATTER_DOCUMENT.id}, ${ws}, ${MATTER_DOCUMENT.kind},
            ${`ws/${ws}/document/${MATTER_DOCUMENT.id}`}, ${'a'.repeat(64)}, 'skipped', ${MAIN_MATTER.id})`;
  // The bulk: ids count up from fixed bases (0xb2000000 and 0xc2000000) so every run seeds the same
  // rows. Parameters are cast: Postgres cannot infer the type of a bare `$n` in these positions.
  await tx`
    insert into matter (id, workspace_id, title)
    select ('00000000-0000-4000-8000-' || lpad(to_hex(2986344448 + i), 12, '0'))::uuid,
           ${ws}::uuid,
           ${PERF_TITLE_PREFIX}::text || ' ' || lpad(i::text, 4, '0') || ' v. Fictional Respondent'
    from generate_series(1, ${PERF_MATTERS}::int) as i`;
  await tx`
    insert into proceeding (id, workspace_id, matter_id, forum_id, case_type_code, number, year,
      state, source_type, confirmation_state)
    select ('00000000-0000-4000-8000-' || lpad(to_hex(3254779904 + i * 10 + k), 12, '0'))::uuid,
           ${ws}::uuid,
           ('00000000-0000-4000-8000-' || lpad(to_hex(2986344448 + i), 12, '0'))::uuid,
           ${forum}::uuid, 'WP', (10000 + i * 10 + k)::text, 2023, 'numbered', 'manual',
           'confirmed'
    from generate_series(1, ${PERF_MATTERS}::int) as i,
         generate_series(1, ${PERF_PROCEEDINGS_PER_MATTER}::int) as k`;
}
