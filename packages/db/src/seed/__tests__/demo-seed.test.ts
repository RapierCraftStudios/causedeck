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
  demoCourtRows,
  demoMatterRows,
  demoContentHash,
  demoDocumentPdfs,
  demoMemory,
  demoModuleRows,
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

const memorySerialised = (value: unknown): string => JSON.stringify(value);
const courtsFor = (key: DemoWorkspaceKey) =>
  demoCourtRows(DEMO_WORKSPACES[key], new Date(`${TODAY}T03:30:00Z`));
const demoMatterRowsFor = (key: DemoWorkspaceKey) =>
  demoMatterRows(DEMO_WORKSPACES[key], TODAY, new Date(`${TODAY}T03:30:00Z`));

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
  // The product modules (#985).
  'client_contact',
  'enquiry',
  'enquiry_party',
  'conflict_check_result',
  'list_snapshot',
  'court_day_marker',
  'brief_state',
  'handover_note',
  'matter_view',
  'appearance',
  'preparedness_rating',
  'load_pulse',
  'fee_agreement',
  'fee_invoice',
  'fee_invoice_line',
  'payment',
  'client_ledger_entry',
  'limitation_rule',
  'limitation_computation',
  'status_link',
  'outward_draft',
  'outward_draft_version',
  'template',
  'draft',
  'draft_version',
  'capture',
  'proposal',
  'notification',
  'matter_issue_tag',
  'research_note',
  'defect',
  'certified_copy',
  'obligation_event',
  'portfolio',
  'portfolio_case',
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
      ).toEqual([
        { key: 'insights.enabled', enabled: true },
        { key: 'm5_playbooks', enabled: true },
      ]);
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

describe('demo seed: every product module (#985)', () => {
  beforeAll(async () => {
    await seedDemo(db, { today: TODAY });
  });

  /** One check per module: the page of that module is not empty in either workspace. */
  const MODULE_MINIMUMS: Record<string, number> = {
    // module table: at least this many rows per workspace
    client_contact: 10,
    enquiry: 5,
    enquiry_party: 10,
    conflict_check_result: 2,
    list_snapshot: 2,
    court_day_marker: 1,
    brief_state: 4,
    appearance: 8,
    preparedness_rating: 0,
    load_pulse: 2,
    fee_agreement: 10,
    fee_invoice: 8,
    fee_invoice_line: 8,
    payment: 2,
    client_ledger_entry: 20,
    limitation_rule: 3,
    limitation_computation: 3,
    status_link: 1,
    outward_draft: 3,
    outward_draft_version: 3,
    template: 1,
    draft: 3,
    draft_version: 3,
    capture: 6,
    proposal: 3,
    activity: 4,
    notification: 3,
    matter_issue_tag: 4,
    research_note: 2,
    defect: 3,
    certified_copy: 3,
    obligation_event: 6,
    portfolio: 1,
    portfolio_case: 6,
  };

  it.each(DEMO_WORKSPACE_KEYS)('%s: no module is an empty page', async (key) => {
    for (const [table, minimum] of Object.entries(MODULE_MINIMUMS)) {
      expect(
        await countIn(key, `select 1 from "${table}"`),
        `${table} rows in ${key}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  });

  it.each(DEMO_WORKSPACE_KEYS)(
    '%s: has a conflict card with hits, and one without',
    async (key) => {
      const results = await rowsIn<{ hit_count: number; hits: unknown[]; status: string }>(
        key,
        `select c.hit_count, c.hits, e.status from conflict_check_result c join enquiry e on e.id = c.enquiry_id order by c.id`,
      );
      expect(results.some((r) => r.hit_count >= 2 && r.hits.length === r.hit_count)).toBe(true);
      expect(results.some((r) => r.hit_count === 0)).toBe(true);
    },
  );

  it.each(DEMO_WORKSPACE_KEYS)(
    '%s: has a list diff (two snapshots of one forum and day)',
    async (key) => {
      const forums = await rowsIn<{ forum_id: string; n: number; types: string }>(
        key,
        `select forum_id, count(*)::int as n, string_agg(list_type::text, ',' order by created_at) as types
       from list_snapshot where list_date = '${TODAY}' group by forum_id`,
      );
      expect(forums.length).toBeGreaterThanOrEqual(1);
      for (const f of forums) expect(f).toMatchObject({ n: 2, types: 'daily,supplementary' });
      const [daily, supp] = await rowsIn<{ rows: { proceedingKey: string }[] }>(
        key,
        `select rows from list_snapshot where list_date = '${TODAY}' order by forum_id, created_at limit 2`,
      );
      const a = new Set(daily?.rows.map((r) => r.proceedingKey));
      const b = new Set(supp?.rows.map((r) => r.proceedingKey));
      expect([...a].some((k) => !b.has(k))).toBe(true); // a row removed
      expect([...b].some((k) => !a.has(k))).toBe(true); // a row added
    },
  );

  it.each(DEMO_WORKSPACE_KEYS)('%s: has an order with an unreconciled direction', async (key) => {
    const [row] = await rowsIn<{ directions: number; linked: number; unresolved: number }>(
      key,
      `select jsonb_array_length(o.operative_directions)::int as directions,
              (select count(*) from obligation b where b.source_order_id = o.id)::int as linked,
              (select count(*) from jsonb_array_elements(o.operative_directions) d
                where not exists (select 1 from obligation b where b.source_order_id = o.id
                  and b.anchor_id = (d->>'anchorId')::uuid))::int as unresolved
       from "order" o where o.id = '${demoModuleRows(DEMO_WORKSPACES[key], TODAY, new Date(`${TODAY}T03:30:00Z`), demoMatterRowsFor(key), courtsFor(key)).orders[0]?.id ?? ''}'`,
    );
    expect(row).toEqual({ directions: 3, linked: 2, unresolved: 1 });
  });

  it('has a junior handover in the Bengaluru chamber only', async () => {
    const chamber = 'bengaluru-chamber' as const;
    const ws = DEMO_WORKSPACES[chamber];
    const junior = demoMember(ws, 'junior');
    const notes = await rowsIn<{
      recipient_id: string;
      author_id: string;
      acknowledged_at: string | null;
    }>(chamber, 'select recipient_id, author_id, acknowledged_at from handover_note order by id');
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes.every((n) => n.recipient_id === junior.memberId)).toBe(true);
    expect(notes.some((n) => n.acknowledged_at === null)).toBe(true);
    expect(
      await countIn(chamber, `select 1 from appearance where member_id = '${junior.memberId}'`),
    ).toBeGreaterThan(0);
    expect(await countIn('chennai-solo', 'select 1 from handover_note')).toBe(0);
  });

  it('stores the module jsonb in the shapes the services read', async () => {
    const { HandoverContent } = await import('@causedeck/validators');
    const { ComputationResult } = await import('@causedeck/validators/limitation');
    const { StatusLinkPayload } = await import('@causedeck/validators/status-link');
    for (const key of DEMO_WORKSPACE_KEYS) {
      for (const r of await rowsIn<{ body: unknown }>(key, 'select body from handover_note')) {
        expect(HandoverContent.safeParse(r.body).success).toBe(true);
      }
      for (const r of await rowsIn<{ result: unknown }>(
        key,
        'select result from limitation_computation',
      )) {
        expect(ComputationResult.safeParse(r.result).success).toBe(true);
      }
      for (const r of await rowsIn<{ payload: unknown }>(key, 'select payload from status_link')) {
        expect(StatusLinkPayload.safeParse(r.payload).success).toBe(true);
      }
    }
  });

  it('writes nothing outward: no email, push, webhook, invitation, share, AI or billing row', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const [org] = await rowsIn<{ is_demo: boolean }>(key, 'select is_demo from organization');
      expect(org?.is_demo).toBe(true);
      for (const table of [
        'webhook_endpoint',
        'webhook_delivery',
        'invitation',
        'push_subscription',
        'whatsapp_link',
        'outward_share_log',
        'reminder_dispatch',
        'intake_address',
        'subscription',
        'ai_call',
        'usage_reservation',
        'brief_share',
        'status_link_access',
        'draft_export',
      ]) {
        expect(await countIn(key, `select 1 from "${table}"`), table).toBe(0);
      }
      // Outward drafts are only ever drafted or edited, never shared; the notifications are in-app rows.
      expect(await countIn(key, `select 1 from outward_draft where status = 'shared'`)).toBe(0);
      expect(
        await countIn(
          key,
          `select 1 from client_contact where email not like '%@demo.causedeck.test'`,
        ),
      ).toBe(0);
    }
  });

  it('keeps every module text fictional and synthetic', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const text = [
        ...(await rowsIn<{ t: string }>(key, 'select summary as t from enquiry')),
        ...(await rowsIn<{ t: string }>(key, 'select body as t from outward_draft_version')),
        ...(await rowsIn<{ t: string }>(key, 'select enquirer_name as t from enquiry')),
      ]
        .map((r) => r.t.toLowerCase())
        .join('\n');
      for (const word of REAL_NAME_BLOCKLIST) expect(text).not.toContain(word);
      const names = await rowsIn<{ t: string }>(key, 'select enquirer_name as t from enquiry');
      for (const n of names) expect(n.t.endsWith(FICTIONAL_SUFFIX)).toBe(true);
    }
  });

  it('covers memory M1 to M5 with provenance, proposals in every state and usage', () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const ws = DEMO_WORKSPACES[key];
      const memory = demoMemory(ws, TODAY);
      for (const layer of ['M1', 'M2', 'M3', 'M4', 'M5']) {
        expect(
          memory.items.some((i) => i.layer === layer),
          `${layer} in ${key}`,
        ).toBe(true);
      }
      expect(new Set(memory.items.map((i) => i.id)).size).toBe(memory.items.length);
      for (const item of memory.items) {
        expect(item.sourceRef.length).toBeGreaterThan(0);
        expect((item.layer === 'M3') === (item.scope === 'matter')).toBe(true);
        expect(item.key.startsWith(`${item.layer}.`)).toBe(true);
        expect(memorySerialised(item.value)).not.toMatch(
          /\b(judge|bench|justice|magistrate|hon'?ble)\b/i,
        );
      }
      expect(memory.items.some((i) => i.sharedWithChamber)).toBe(true);
      expect(new Set(memory.proposals.map((p) => p.status))).toEqual(
        new Set(['proposed', 'dismissed', 'observing']),
      );
      expect(memory.usages.length).toBeGreaterThan(0);
      const ids = new Set(memory.items.map((i) => i.id));
      expect(memory.usages.every((u) => ids.has(u.itemId))).toBe(true);
    }
  });

  it('has a sample PDF for every order document, with the hash the row stores', async () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const ws = DEMO_WORKSPACES[key];
      const pdfs = demoDocumentPdfs(ws, TODAY, new Date(`${TODAY}T03:30:00Z`));
      const docs = await rowsIn<{ id: string; storage_key: string; sha256: string }>(
        key,
        `select id, storage_key, sha256 from document where kind = 'order'`,
      );
      expect(pdfs.length).toBe(docs.length);
      const byId = new Map(docs.map((d) => [d.id, d]));
      for (const pdf of pdfs) {
        expect(byId.get(pdf.documentId)).toMatchObject({
          storage_key: pdf.storageKey,
          sha256: pdf.sha256,
        });
        expect(Buffer.from(pdf.bytes).toString('latin1')).toContain(DEMO_PDF_WATERMARK);
      }
    }
  });

  it('keeps the module rows deterministic and in the content hash', () => {
    for (const key of DEMO_WORKSPACE_KEYS) {
      const ws = DEMO_WORKSPACES[key];
      expect(demoMemory(ws, DEMO_HASH_DAY)).toEqual(demoMemory(ws, DEMO_HASH_DAY));
      expect(demoContentHash(key)).toBe(demoContentHash(key));
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
