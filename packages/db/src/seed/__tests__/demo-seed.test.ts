// The demo seed (#182): a fictional `demo` workspace with three members and 25 Madras HC and
// Bengaluru matters, idempotent, refused in production, fictional names and fake case numbers only.
import { createHash } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { DEMO_WORKSPACE_SLUG } from '@causedeck/validators/workspace';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../client.ts';
import { runMigrations } from '../../migrate.ts';
import { createOwnerDb } from '../../owner.ts';
import { withWorkspace } from '../../rls.ts';
import { createScratchDatabase, testDatabaseUrls } from '../../testing/index.ts';
import {
  addDays,
  DEMO_MATTER_COUNT,
  DEMO_PDF_HEADING,
  DEMO_USERS,
  DEMO_WORKSPACE_ID,
  demoCaseNumber,
  demoOrderPdf,
  DemoSeedInProductionError,
  FICTIONAL_SUFFIX,
  seedDemo,
} from '../demo/index.ts';
import { registeredSeeds } from '../index.ts';

const TODAY = '2026-10-21';
const TOMORROW = addDays(TODAY, 1);

const TABLES = [
  'organization',
  'user',
  'member',
  'forum',
  'court_hall',
  'bench',
  'matter',
  'person',
  'role_edge',
  'proceeding',
  'proceeding_link',
  'document',
  'anchor',
  'order',
  'listing',
  'hearing',
  'obligation',
  'task',
] as const;

let db: Database;
let drop: () => Promise<void>;

/** Run `query` inside the demo workspace (FORCE RLS) and return its rows. */
async function rows<T extends Record<string, unknown>>(query: string): Promise<T[]> {
  const result = await withWorkspace(db, { workspaceId: DEMO_WORKSPACE_ID }, (tx) =>
    tx.execute(sql.raw(query)),
  );
  return [...result] as T[];
}

async function dump(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of TABLES) {
    const all = await rows<{ row: string }>(
      `select row_to_json(t)::text as row from "${table}" t order by id`,
    );
    out[table] = all.map((r) => r.row).join('\n');
  }
  return out;
}

async function count(query: string): Promise<number> {
  const [row] = await rows<{ n: number }>(`select count(*)::int as n from (${query}) q`);
  return row?.n ?? 0;
}

beforeAll(async () => {
  const scratch = await createScratchDatabase(testDatabaseUrls(), 'demo_seed');
  drop = scratch.drop;
  await runMigrations({ url: new Secret(scratch.owner) });
  // `pnpm db:seed:demo` seeds as the owner role.
  db = createOwnerDb(new Secret(scratch.owner));
});

afterAll(async () => {
  await db.$client.end();
  await drop();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('demo seed (#182)', () => {
  it('registers only for the demo profile', () => {
    expect(registeredSeeds('demo').map((s) => s.name)).toContain('demo-workspace');
    expect(registeredSeeds('e2e').map((s) => s.name)).not.toContain('demo-workspace');
    expect(registeredSeeds('test').map((s) => s.name)).not.toContain('demo-workspace');
  });

  it('never runs when NODE_ENV=production and writes nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(seedDemo(db, { today: TODAY })).rejects.toBeInstanceOf(DemoSeedInProductionError);
    vi.unstubAllEnvs();
    expect(await count('select 1 from organization')).toBe(0);
    expect(await count('select 1 from matter')).toBe(0);
  });

  it('seeds once and a second run is a no-op', async () => {
    await seedDemo(db, { today: TODAY });
    const first = await dump();
    expect(first.matter).not.toBe('');
    await seedDemo(db, { today: TODAY });
    expect(await dump()).toEqual(first);
    // A later day changes nothing either: the rows exist, so nothing is written.
    await seedDemo(db, { today: addDays(TODAY, 3) });
    expect(await dump()).toEqual(first);
  });

  it('creates the demo workspace with an advocate (owner), a junior and a clerk', async () => {
    const [ws] = await rows<{ slug: string; name: string }>('select slug, name from organization');
    expect(ws?.slug).toBe(DEMO_WORKSPACE_SLUG);
    expect(ws?.name.endsWith(FICTIONAL_SUFFIX)).toBe(true);
    const members = await rows<{ role: string; email: string }>(
      'select m.role, u.email from member m join "user" u on u.id = m.user_id order by m.id',
    );
    expect(members).toEqual([
      { role: 'owner', email: 'advocate@demo.causedeck.test' },
      { role: 'junior', email: 'junior@demo.causedeck.test' },
      { role: 'clerk', email: 'clerk@demo.causedeck.test' },
    ]);
    expect(DEMO_USERS).toHaveLength(3);
  });

  it('seeds ~25 matters across Madras HC and the Bengaluru courts, every practice area', async () => {
    const matters = await count('select 1 from matter');
    expect(matters).toBe(DEMO_MATTER_COUNT);
    expect(matters).toBeGreaterThanOrEqual(20);
    expect(matters).toBeLessThanOrEqual(30);
    const byCourt = await rows<{ court: string; n: number }>(
      `select f.court, count(distinct p.matter_id)::int as n from proceeding p
       join forum f on f.id = p.forum_id where p.kind = 'main' group by f.court order by f.court`,
    );
    const n = (court: string) => byCourt.find((r) => r.court === court)?.n ?? 0;
    expect(n('High Court of Madras')).toBeGreaterThanOrEqual(12);
    expect(n('City Civil Court, Bengaluru')).toBeGreaterThan(0);
    expect(n('High Court of Karnataka')).toBeGreaterThan(0);
    expect(n('City Civil Court, Bengaluru') + n('High Court of Karnataka')).toBeGreaterThanOrEqual(
      12,
    );
    const areas = await rows<{ practice_area: string; n: number }>(
      'select practice_area, count(*)::int as n from matter group by practice_area',
    );
    expect(areas.map((a) => a.practice_area).sort()).toEqual([
      'arbitration',
      'bail',
      'civil_suit',
      'family',
      'writ',
    ]);
    for (const a of areas) expect(a.n).toBeGreaterThanOrEqual(3);
  });

  it('gives every matter a party, a client, a proceeding, an order with its PDF and an obligation', async () => {
    const missing = await rows<{ id: string }>(
      `select m.id from matter m where
         not exists (select 1 from role_edge i
                     join person c on c.id = i.from_person_id and c.kind = 'client'
                     join role_edge o on o.to_person_id = c.id and o.kind = 'opposes'
                     join person p on p.id = o.from_person_id and p.kind = 'party'
                     where i.matter_id = m.id and i.kind = 'instructed_by')
      or not exists (select 1 from proceeding p where p.matter_id = m.id)
      or not exists (select 1 from "order" o join proceeding p on p.id = o.proceeding_id
                     join document d on d.id = o.document_id
                     where p.matter_id = m.id and d.kind = 'order')
      or not exists (select 1 from obligation o where o.matter_id = m.id)`,
    );
    expect(missing).toEqual([]);
    // The writ graph: a W.P. with two W.M.P.s and a W.A. against it.
    expect(await count(`select 1 from proceeding_link where kind = 'parent_of'`)).toBe(2);
    expect(await count(`select 1 from proceeding_link where kind = 'appeal_from'`)).toBe(1);
  });

  it('lists hearings today and tomorrow, with at most one canonical next date per proceeding', async () => {
    expect(
      await count(`select 1 from listing where list_date = '${TODAY}'`),
    ).toBeGreaterThanOrEqual(3);
    expect(
      await count(`select 1 from listing where list_date = '${TOMORROW}'`),
    ).toBeGreaterThanOrEqual(3);
    expect(
      await count(
        `select 1 from listing where canonical group by proceeding_id having count(*) > 1`,
      ),
    ).toBe(0);
    expect(await count(`select 1 from hearing where held_on < '${TODAY}'`)).toBeGreaterThan(0);
    // Every active numbered main proceeding has a next date.
    expect(
      await count(
        `select 1 from proceeding p join matter m on m.id = p.matter_id
         where p.kind = 'main' and m.status = 'active'
           and not exists (select 1 from listing l where l.proceeding_id = p.id and l.canonical)`,
      ),
    ).toBe(0);
  });

  it('has overdue, due-today, upcoming and done obligations', async () => {
    const open = `select 1 from obligation where status = 'open'`;
    expect(await count(`${open} and due_date < '${TODAY}'`)).toBeGreaterThanOrEqual(3);
    expect(await count(`${open} and due_date = '${TODAY}'`)).toBeGreaterThanOrEqual(3);
    expect(await count(`${open} and due_date > '${TODAY}'`)).toBeGreaterThanOrEqual(5);
    expect(
      await count(`select 1 from obligation where status = 'done' and closed_by is not null`),
    ).toBeGreaterThanOrEqual(3);
  });

  it('uses fictional names and fake case numbers only', async () => {
    const numbers = await rows<{ number: string | null; cnr: string | null }>(
      'select number, cnr from proceeding',
    );
    for (const p of numbers) {
      if (p.number !== null) expect(p.number).toMatch(/^DEMO-\d{4}$/);
      expect(p.cnr).toBeNull();
    }
    expect(await count('select 1 from "order" where neutral_citation is not null')).toBe(0);
    const names = await rows<{ name: string }>(
      `select name from person union all select name from "user"
       union all select name from organization union all select unnest(judges) from bench`,
    );
    expect(names.length).toBeGreaterThan(50);
    for (const { name } of names) expect(name.endsWith(FICTIONAL_SUFFIX), name).toBe(true);
    const emails = await rows<{ email: string }>('select email from "user"');
    for (const { email } of emails) expect(email).toMatch(/@demo\.causedeck\.test$/);
    const titles = await rows<{ title: string }>('select title from matter');
    for (const { title } of titles) expect(title).toMatch(/\(fictional\) v\. .*\(fictional\)$/);
    expect(demoCaseNumber('WP', 2026, 1)).toBe('WP-DEMO/2026/0001');
  });

  it('stores order documents with the generated sample PDF hash under the workspace prefix', async () => {
    const docs = await rows<{ storage_key: string; sha256: string }>(
      'select storage_key, sha256 from document',
    );
    expect(docs).toHaveLength(DEMO_MATTER_COUNT);
    for (const d of docs) {
      expect(d.storage_key.startsWith(`ws/${DEMO_WORKSPACE_ID}/document/`)).toBe(true);
      expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const input = { caseNumber: 'WP-DEMO/2026/0001', title: 'Interim order', lines: ['Lorem'] };
    const a = demoOrderPdf(input);
    const b = demoOrderPdf(input);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const text = Buffer.from(a.bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain(DEMO_PDF_HEADING);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(a.sha256).toBe(createHash('sha256').update(a.bytes).digest('hex'));
  });
});
