// The demo seed (#182, #93): two fictional workspaces (Chennai solo, Bengaluru chamber), 40
// matters each, idempotent, deterministic, versioned, refused in production, fictional names and
// fake case numbers only, SYNTHETIC documents, resettable.
import { createHash } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDb, type Database } from '../../client.ts';
import { runMigrations } from '../../migrate.ts';
import { createOwnerDb } from '../../owner.ts';
import { withWorkspace } from '../../rls.ts';
import { createScratchDatabase, testDatabaseUrls } from '../../testing/index.ts';
import {
  addDays,
  DEMO_HASH_DAY,
  DEMO_MATTERS_PER_WORKSPACE,
  DEMO_PDF_HEADING,
  DEMO_PDF_WATERMARK,
  DEMO_VERSION,
  DEMO_WORKSPACE_KEYS,
  DEMO_WORKSPACES,
  demoCaseNumber,
  demoContentHash,
  demoMember,
  demoOrderPdf,
  DemoSeedInProductionError,
  demoUsers,
  FICTIONAL_SUFFIX,
  resetDemoWorkspace,
  seedDemo,
  type DemoWorkspaceKey,
} from '../demo/index.ts';
import { deleteOrder } from '../demo/reset.ts';
import { registeredSeeds } from '../index.ts';

const TODAY = '2026-10-21';
const TOMORROW = addDays(TODAY, 1);

/** Real advocates, parties and organisations that must never appear in demo data. */
const REAL_NAME_BLOCKLIST = [
  'salve',
  'sibal',
  'rohatgi',
  'singhvi',
  'nariman',
  'jethmalani',
  'divan',
  'venugopal',
  'tata',
  'reliance',
  'adani',
  'infosys',
  'wipro',
  'ambani',
  'mallya',
  'kejriwal',
  'modi',
  'gandhi',
  'karnataka bank',
  'state bank',
  'supreme court',
];

const TABLES = [
  'organization',
  'workspace_settings',
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

/** The owner role writes (like `pnpm db:seed:demo`); the app role reads, so RLS applies. */
let db: Database;
let appDb: Database;
let drop: () => Promise<void>;

/** Run `query` inside workspace `key` (FORCE RLS) and return its rows. */
async function rowsIn<T extends Record<string, unknown>>(
  key: DemoWorkspaceKey,
  query: string,
): Promise<T[]> {
  const result = await withWorkspace(appDb, { workspaceId: DEMO_WORKSPACES[key].id }, (tx) =>
    tx.execute(sql.raw(query)),
  );
  return [...result] as T[];
}

async function countIn(key: DemoWorkspaceKey, query: string): Promise<number> {
  const [row] = await rowsIn<{ n: number }>(key, `select count(*)::int as n from (${query}) q`);
  return row?.n ?? 0;
}

async function dump(key: DemoWorkspaceKey): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of TABLES) {
    const all = await rowsIn<{ row: string }>(
      key,
      `select row_to_json(t)::text as row from "${table}" t order by ${table === 'workspace_settings' ? 'workspace_id' : 'id'}`,
    );
    out[table] = all.map((r) => r.row).join('\n');
  }
  return out;
}

beforeAll(async () => {
  const scratch = await createScratchDatabase(testDatabaseUrls(), 'demo_seed');
  drop = scratch.drop;
  await runMigrations({ url: new Secret(scratch.owner) });
  // `pnpm db:seed:demo` seeds as the owner role.
  db = createOwnerDb(new Secret(scratch.owner));
  appDb = createDb({ url: new Secret(scratch.app), role: 'app', max: 2 });
});

afterAll(async () => {
  await appDb.$client.end();
  await db.$client.end();
  await drop();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('demo seed: registration and safety', () => {
  it('registers only for the demo profile', () => {
    expect(registeredSeeds('demo').map((s) => s.name)).toContain('demo-workspace');
    expect(registeredSeeds('e2e').map((s) => s.name)).not.toContain('demo-workspace');
    expect(registeredSeeds('test').map((s) => s.name)).not.toContain('demo-workspace');
  });

  it('never runs when NODE_ENV=production and writes nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(seedDemo(db, { today: TODAY })).rejects.toBeInstanceOf(DemoSeedInProductionError);
    vi.unstubAllEnvs();
    for (const key of DEMO_WORKSPACE_KEYS) {
      expect(await countIn(key, 'select 1 from organization')).toBe(0);
    }
  });
});

describe('demo seed: content', () => {
  beforeAll(async () => {
    await seedDemo(db, { today: TODAY });
  });

  it('seeds twice and the second run (even on a later day) changes nothing', async () => {
    const first = Object.fromEntries(
      await Promise.all(DEMO_WORKSPACE_KEYS.map(async (k) => [k, await dump(k)] as const)),
    );
    await seedDemo(db, { today: TODAY });
    await seedDemo(db, { today: addDays(TODAY, 3) });
    for (const key of DEMO_WORKSPACE_KEYS) expect(await dump(key)).toEqual(first[key]);
  });

  it.each(DEMO_WORKSPACE_KEYS)('%s: is a flagged, versioned, fictional workspace', async (key) => {
    const ws = DEMO_WORKSPACES[key];
    const [org] = await rowsIn<{ id: string; slug: string; name: string; is_demo: boolean }>(
      key,
      'select id, slug, name, is_demo from organization',
    );
    expect(org).toMatchObject({ id: ws.id, slug: ws.slug, is_demo: true });
    expect(org?.name.endsWith(FICTIONAL_SUFFIX)).toBe(true);
    const [settings] = await rowsIn<{ demo_version: string; practice_city: string }>(
      key,
      'select demo_version, practice_city from workspace_settings',
    );
    expect(settings).toEqual({ demo_version: DEMO_VERSION, practice_city: ws.practiceCity });
    const members = await rowsIn<{ role: string; email: string }>(
      key,
      'select m.role, u.email from member m join "user" u on u.id = m.user_id order by m.id',
    );
    expect(members).toEqual(demoUsers(ws).map((u) => ({ role: u.role, email: u.email })));
    expect(members[0]?.role).toBe('owner');
  });

  it('gives the Bengaluru chamber a junior and the Chennai solo advocate none', () => {
    expect(demoUsers(DEMO_WORKSPACES['bengaluru-chamber']).map((u) => u.key)).toContain('junior');
    expect(demoUsers(DEMO_WORKSPACES['chennai-solo']).map((u) => u.key)).not.toContain('junior');
    expect(() => demoMember(DEMO_WORKSPACES['chennai-solo'], 'junior')).toThrow();
  });

  it('turns m5_playbooks on for the demo workspaces only (#901)', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      expect(
        await rowsIn(key, 'select key, enabled from workspace_feature_flag order by key'),
      ).toEqual([{ key: 'm5_playbooks', enabled: true }]);
    }
  });

  it.each(DEMO_WORKSPACE_KEYS)('%s: has the issue counts and the right courts', async (key) => {
    expect(await countIn(key, 'select 1 from matter')).toBe(DEMO_MATTERS_PER_WORKSPACE);
    expect(await countIn(key, 'select 1 from "order"')).toBeGreaterThanOrEqual(60);
    expect(await countIn(key, 'select 1 from obligation')).toBeGreaterThanOrEqual(120);
    for (const source of ['registry_defect', 'certified_copy', 'order_direction', 'internal']) {
      expect(
        await countIn(key, `select 1 from obligation where source = '${source}'`),
        source,
      ).toBeGreaterThan(5);
    }
    // 30 days of lists: a list on every one of the last 30 days.
    const days = await countIn(
      key,
      `select distinct list_date from listing
       where list_date between '${addDays(TODAY, -30)}' and '${addDays(TODAY, -1)}'`,
    );
    expect(days).toBeGreaterThanOrEqual(30);
    const courts = (
      await rowsIn<{ court: string }>(
        key,
        `select distinct f.court from proceeding p join forum f on f.id = p.forum_id
         where p.kind = 'main' order by f.court`,
      )
    ).map((r) => r.court);
    if (key === 'chennai-solo') {
      expect(courts).toEqual(['High Court of Madras']);
    } else {
      expect(courts).toEqual([
        'City Civil Court, Bengaluru',
        'High Court of Karnataka',
        'Mayo Hall Court Complex, Bengaluru',
      ]);
    }
    const areas = await rowsIn<{ practice_area: string }>(
      key,
      'select distinct practice_area from matter',
    );
    expect(areas.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the writ graph in the Chennai workspace (W.P., two W.M.P.s, a W.A.)', async () => {
    const link = (kind: string) =>
      countIn('chennai-solo', `select 1 from proceeding_link where kind = '${kind}'`);
    expect(await link('parent_of')).toBe(2);
    expect(await link('appeal_from')).toBe(1);
  });

  it.each(DEMO_WORKSPACE_KEYS)('%s: satisfies the schema invariants', async (key) => {
    // Every matter has a client, a party, a proceeding, an order with its document and an obligation.
    expect(
      await rowsIn(
        key,
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
      ),
    ).toEqual([]);
    // Provenance on every fact.
    for (const table of [
      'proceeding',
      'listing',
      'hearing',
      'order',
      'obligation',
      'task',
      'person',
    ]) {
      expect(
        await countIn(
          key,
          `select 1 from "${table}" where source_type is null or confirmation_state is null or captured_at is null`,
        ),
        table,
      ).toBe(0);
    }
    // One canonical next date per proceeding, and every active matter has one.
    expect(
      await countIn(
        key,
        'select 1 from listing where canonical group by proceeding_id having count(*) > 1',
      ),
    ).toBe(0);
    expect(
      await countIn(
        key,
        `select 1 from proceeding p join matter m on m.id = p.matter_id
         where p.kind = 'main' and m.status = 'active'
           and not exists (select 1 from listing l where l.proceeding_id = p.id and l.canonical)`,
      ),
    ).toBe(0);
    // Obligations close only with a reason.
    expect(
      await countIn(
        key,
        `select 1 from obligation where status <> 'open'
           and (closed_reason_type is null or closed_at is null)`,
      ),
    ).toBe(0);
    // No cross-workspace foreign keys: every row of the workspace is the workspace's own.
    for (const table of TABLES.filter((t) => t !== 'user' && t !== 'organization')) {
      expect(
        await countIn(
          key,
          `select 1 from "${table}" where workspace_id <> '${DEMO_WORKSPACES[key].id}'`,
        ),
        table,
      ).toBe(0);
    }
  });

  it('lists hearings today and tomorrow in each workspace and has past hearings', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      expect(
        await countIn(key, `select 1 from listing where list_date = '${TODAY}'`),
      ).toBeGreaterThanOrEqual(3);
      expect(
        await countIn(key, `select 1 from listing where list_date = '${TOMORROW}'`),
      ).toBeGreaterThanOrEqual(3);
      expect(
        await countIn(key, `select 1 from hearing where held_on < '${TODAY}'`),
      ).toBeGreaterThan(0);
    }
  });

  it('has overdue, due-today, upcoming and done obligations', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const open = `select 1 from obligation where status = 'open'`;
      expect(await countIn(key, `${open} and due_date < '${TODAY}'`)).toBeGreaterThanOrEqual(3);
      expect(await countIn(key, `${open} and due_date = '${TODAY}'`)).toBeGreaterThanOrEqual(3);
      expect(await countIn(key, `${open} and due_date > '${TODAY}'`)).toBeGreaterThanOrEqual(5);
      expect(
        await countIn(
          key,
          `select 1 from obligation where status = 'done' and closed_by is not null`,
        ),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps each workspace invisible to the other (RLS)', async () => {
    const other = await rowsIn<{ id: string }>(
      'chennai-solo',
      `select id from matter where id::text like '%d20%' and workspace_id <> '${DEMO_WORKSPACES['chennai-solo'].id}'`,
    );
    expect(other).toEqual([]);
    const ids = await rowsIn<{ id: string }>('bengaluru-chamber', 'select id from matter');
    const mine = new Set(
      (await rowsIn<{ id: string }>('chennai-solo', 'select id from matter')).map((r) => r.id),
    );
    expect(ids.filter((r) => mine.has(r.id))).toEqual([]);
  });

  it('uses fictional names, fake case numbers and reserved addresses only', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const numbers = await rowsIn<{ number: string | null; cnr: string | null }>(
        key,
        'select number, cnr from proceeding',
      );
      for (const p of numbers) {
        if (p.number !== null) expect(p.number).toMatch(/^DEMO-\d{4}$/);
        expect(p.cnr).toBeNull();
      }
      expect(await countIn(key, 'select 1 from "order" where neutral_citation is not null')).toBe(
        0,
      );
      const names = await rowsIn<{ name: string }>(
        key,
        `select name from person union all select name from "user"
         union all select name from organization union all select unnest(judges) from bench`,
      );
      expect(names.length).toBeGreaterThan(50);
      for (const { name } of names) {
        expect(name.endsWith(FICTIONAL_SUFFIX), name).toBe(true);
        for (const real of REAL_NAME_BLOCKLIST)
          expect(name.toLowerCase(), name).not.toContain(real);
      }
      const emails = await rowsIn<{ email: string }>(key, 'select email from "user"');
      for (const { email } of emails) expect(email).toMatch(/@demo\.causedeck\.test$/);
      const titles = await rowsIn<{ title: string }>(key, 'select title from matter');
      for (const { title } of titles) {
        expect(title).toMatch(/\(fictional\) v\. .*\(fictional\)$/);
        for (const real of REAL_NAME_BLOCKLIST)
          expect(title.toLowerCase(), title).not.toContain(real);
      }
    }
    expect(demoCaseNumber('WP', 2026, 1)).toBe('WP-DEMO/2026/0001');
  });

  it('stores order documents with the SYNTHETIC sample PDF hash under the workspace prefix', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const docs = await rowsIn<{ storage_key: string; sha256: string }>(
        key,
        'select storage_key, sha256 from document',
      );
      expect(docs.length).toBe(await countIn(key, 'select 1 from "order"'));
      for (const d of docs) {
        expect(d.storage_key.startsWith(`ws/${DEMO_WORKSPACES[key].id}/document/`)).toBe(true);
        expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    const input = { caseNumber: 'WP-DEMO/2026/0001', title: 'Interim order', lines: ['Lorem'] };
    const a = demoOrderPdf(input);
    const b = demoOrderPdf(input);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const text = Buffer.from(a.bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain(DEMO_PDF_HEADING);
    expect(DEMO_PDF_WATERMARK).toBe('SYNTHETIC');
    expect(text.match(/SYNTHETIC/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(a.sha256).toBe(createHash('sha256').update(a.bytes).digest('hex'));
  });

  it('is deterministic: the content hash is stable and each workspace differs', () => {
    expect(DEMO_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    expect(DEMO_HASH_DAY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const hashes = DEMO_WORKSPACE_KEYS.map((k) => demoContentHash(k));
    expect(DEMO_WORKSPACE_KEYS.map((k) => demoContentHash(k))).toEqual(hashes);
    expect(new Set(hashes).size).toBe(2);
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('makes no AI call: no ai_call row and no AI output in the seed', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      expect(await countIn(key, 'select 1 from ai_call')).toBe(0);
    }
  });
});

describe('demo reset', () => {
  it('orders deletes children first and rejects a cycle', () => {
    expect(
      deleteOrder(
        ['a', 'b', 'c'],
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
      ),
    ).toEqual(['a', 'b', 'c']);
    expect(deleteOrder(['a'], [['a', 'a']])).toEqual(['a']);
    expect(() =>
      deleteOrder(
        ['a', 'b'],
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
    ).toThrow(/cycle/);
  });

  it('restores a changed workspace to the seed, drops visitors and leaves the other alone', async () => {
    const key = 'bengaluru-chamber' as const;
    const other = 'chennai-solo' as const;
    await seedDemo(db, { today: TODAY });
    const before = await dump(key);
    const otherBefore = await dump(other);
    const ws = DEMO_WORKSPACES[key];

    // A visitor joins and adds a matter of their own.
    await db.execute(sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values ('00000000-0000-4000-8000-0000000000aa', 'Visitor (fictional)',
              'visitor.bengaluru-chamber.aa@demo.causedeck.test', true, now(), now())`);
    await withWorkspace(db, { workspaceId: ws.id }, async (tx) => {
      await tx.execute(sql`insert into member (id, workspace_id, user_id, role, status)
        values ('00000000-0000-4000-8000-0000000000ab', ${ws.id}::uuid,
                '00000000-0000-4000-8000-0000000000aa', 'clerk', 'active')`);
      await tx.execute(sql`delete from task`);
    });
    expect((await dump(key)).member).not.toEqual(before.member);

    const started = Date.now();
    const result = await resetDemoWorkspace(db, key, { today: TODAY });
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(result).toMatchObject({ workspaceId: ws.id, visitors: 1 });
    expect(result.rows).toBeGreaterThan(500);
    expect(await dump(key)).toEqual(before);
    expect(await dump(other)).toEqual(otherBefore);
    expect(await countIn(key, `select 1 from "user" where email like 'visitor.%'`)).toBe(0);
  });
});
