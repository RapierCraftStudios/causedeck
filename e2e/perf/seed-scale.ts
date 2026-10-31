// Scale the demo seed to a 1,000-seat equivalent (#105). Run `pnpm db:seed:demo` first (the two
// fictional demo workspaces: 40 matters each, 60+ orders, 120+ obligations; this also calls seedDemo); this adds fictional
// tenants and seats around them. It refuses production and any database host off the allow-list.
//
//   DATABASE_URL_OWNER=... node --experimental-strip-types --no-warnings e2e/perf/seed-scale.ts [seats]
import { fileURLToPath } from 'node:url';

import { Secret } from '@causedeck/config/env';
import { createDb } from '@causedeck/db';
import { seedDemo } from '@causedeck/db/seed/demo';

import { assertAllowedTarget } from './guard.ts';

export interface ScalePlan {
  seats: number;
  workspaces: number;
  solo: number;
  chambers: number;
  /** Matters and listings the demo workspaces carry per seat group (40 matters per workspace). */
  matters: number;
  listings: number;
  /** Open proposals and needs-you captures seeded into each demo workspace's inbox (#489). */
  inboxItems: number;
}

/** The inbox budget is measured with this many items per workspace (#48: p95 under 300 ms). */
export const INBOX_ITEMS = 200;

/** The demo workspaces whose inbox carries `INBOX_ITEMS` items: the ones the k6 users sign in to. */
export const INBOX_WORKSPACE_SLUGS = ['demo-chennai-solo', 'demo-bengaluru-chamber'] as const;

/** Seats per workspace: a solo advocate has 2 (advocate, clerk), a chamber 3. About 2 in 3 are solo. */
export function planScale(seats: number): ScalePlan {
  if (!Number.isInteger(seats) || seats < 1)
    throw new RangeError('seats must be a positive integer');
  let solo = 0;
  let chambers = 0;
  let placed = 0;
  while (placed < seats) {
    if ((solo + chambers) % 3 === 2) {
      chambers += 1;
      placed += 3;
    } else {
      solo += 1;
      placed += 2;
    }
  }
  const workspaces = solo + chambers;
  return {
    seats: placed,
    workspaces,
    solo,
    chambers,
    matters: workspaces * 40,
    listings: workspaces * 40 * 3,
    inboxItems: INBOX_ITEMS,
  };
}

/** Deterministic ids and names: no UUID hyphens in slugs, `.test` emails, fictional. */
export function scaleSlug(n: number): string {
  return `demo-scale-${String(n).padStart(4, '0')}`;
}

export function scaleWorkspaceId(n: number): string {
  return `00000000-0000-4000-9${n.toString(16).padStart(3, '0')}-000000000000`;
}

/** Rows of one workspace's inbox: a proposal and an unreadable capture per item. Fictional. */
export async function seedInboxItems(
  sql: ReturnType<typeof createDb>['$client'],
  slug: string,
  items: number = INBOX_ITEMS,
): Promise<number> {
  const [org] = await sql<{ id: string }[]>`select id from organization where slug = ${slug}`;
  if (!org) return 0;
  await sql.begin(async (tx) => {
    await tx`select set_config('app.workspace_id', ${org.id}, true)`;
    await tx`delete from proposal where workspace_id = ${org.id}::uuid and idempotency_key like 'perf-inbox-%'`;
    await tx`delete from capture where workspace_id = ${org.id}::uuid and source_meta ->> 'perfInbox' = '1'`;
    await tx`
      insert into proposal (id, workspace_id, kind, level, status, payload, meta, idempotency_key, confidence)
      select gen_random_uuid(), ${org.id}::uuid, 'task', 'L2', 'proposed',
             jsonb_build_object('title', 'File the counter ' || n || ' (fictional)'),
             jsonb_build_object('source', jsonb_build_object('type', 'deterministic', 'input', 'form'),
               'patternKey', 'task', 'match', null, 'duplicate', null, 'ambiguous', false),
             'perf-inbox-' || n, 0.930
      from generate_series(1, ${items}) n`;
    await tx`
      insert into capture (id, workspace_id, channel, status, mime, size_bytes, source_meta)
      select gen_random_uuid(), ${org.id}::uuid, 'upload', 'needs_you', 'application/pdf', 1000,
             jsonb_build_object('perfInbox', '1')
      from generate_series(1, ${items}) n`;
  });
  return items;
}

export async function seedScale(databaseUrl: string, seats: number): Promise<ScalePlan> {
  // eslint-disable-next-line no-process-env -- a CLI guard on the process environment.
  if (process.env.NODE_ENV === 'production') throw new Error('seed-scale never runs in production');
  // eslint-disable-next-line no-process-env -- allow-list host comes from the environment.
  assertAllowedTarget(databaseUrl.replace(/^postgres(ql)?:/, 'http:'), process.env);
  const plan = planScale(seats);
  const db = createDb({ url: new Secret(databaseUrl), role: 'owner', max: 1, idleTimeout: 0 });
  const sql = db.$client;
  try {
    // The two demo workspaces with their matters, listings, orders and obligations.
    await seedDemo(db);
    // 200 captures with proposals in the demo inboxes the perf users read (#489).
    for (const slug of INBOX_WORKSPACE_SLUGS) await seedInboxItems(sql, slug);
    // Synthetic tenants and seats around them (roles: owner, junior or clerk; solo 2 seats, chamber 3).
    await sql`
      insert into "user" (id, name, email, email_verified)
      select ('00000000-0000-4000-9' || lpad(to_hex(n), 3, '0') || '-' || lpad(to_hex(m), 12, '0'))::uuid,
             'Scale user ' || n || '-' || m || ' (fictional)',
             'scale.' || n || '.' || m || '@demo.causedeck.test', true
      from generate_series(1, ${plan.workspaces}) n, generate_series(1, 3) m
      where m <= case when n % 3 = 0 then 3 else 2 end
      on conflict do nothing`;
    // Workspace tables are under FORCE RLS: one workspace-scoped transaction per tenant.
    for (let n = 1; n <= plan.workspaces; n += 1) {
      const id = scaleWorkspaceId(n);
      await sql.begin(async (tx) => {
        await tx`select set_config('app.workspace_id', ${id}, true)`;
        await tx`
          insert into organization (id, name, slug, kind, is_demo)
          values (${id}::uuid, ${`Scale workspace ${String(n)} (fictional)`}, ${scaleSlug(n)},
                  ${n % 3 === 0 ? 'chamber' : 'solo'}, true)
          on conflict do nothing`;
        await tx`
          insert into member (id, workspace_id, user_id, role)
          select gen_random_uuid(), ${id}::uuid, u.id,
                 case split_part(split_part(u.email, '@', 1), '.', 3) when '1' then 'owner' when '2' then 'clerk' else 'junior' end
          from "user" u
          where u.email like ${`scale.${String(n)}.%@demo.causedeck.test`}
            and not exists (select 1 from member x where x.workspace_id = ${id}::uuid and x.user_id = u.id)`;
      });
    }
  } finally {
    await db.$client.end();
  }
  return plan;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  // eslint-disable-next-line no-process-env -- CLI entry point.
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('DATABASE_URL_OWNER is required');
  const plan = await seedScale(url, Number(process.argv[2] ?? 1000));
  console.log(JSON.stringify(plan));
}
