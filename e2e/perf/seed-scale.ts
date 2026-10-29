// Scale the demo seed to a 1,000-seat equivalent (#105). Run `pnpm db:seed:demo` first (the two
// fictional demo workspaces: 40 matters each, 60+ orders, 120+ obligations); this adds fictional
// tenants and seats around them. It refuses production and any database host off the allow-list.
//
//   DATABASE_URL_OWNER=... node --experimental-strip-types --no-warnings e2e/perf/seed-scale.ts [seats]
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { assertAllowedTarget } from './guard.ts';

export interface ScalePlan {
  seats: number;
  workspaces: number;
  solo: number;
  chambers: number;
  /** Matters and listings the demo workspaces carry per seat group (40 matters per workspace). */
  matters: number;
  listings: number;
}

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
  };
}

/** Deterministic ids and names: no UUID hyphens in slugs, `.test` emails, fictional. */
export function scaleSlug(n: number): string {
  return `demo-scale-${String(n).padStart(4, '0')}`;
}

export async function seedScale(databaseUrl: string, seats: number): Promise<ScalePlan> {
  // eslint-disable-next-line no-process-env -- a CLI guard on the process environment.
  if (process.env.NODE_ENV === 'production') throw new Error('seed-scale never runs in production');
  // eslint-disable-next-line no-process-env -- allow-list host comes from the environment.
  assertAllowedTarget(databaseUrl.replace(/^postgres(ql)?:/, 'http:'), process.env);
  const plan = planScale(seats);
  const sql = postgres(databaseUrl, { max: 2 });
  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into "user" (id, name, email, email_verified)
        select ('00000000-0000-4000-9' || lpad(to_hex(n), 3, '0') || '-' || lpad(to_hex(m), 12, '0'))::uuid,
               'Scale user ' || n || '-' || m || ' (fictional)',
               'scale.' || n || '.' || m || '@demo.causedeck.test', true
        from generate_series(1, ${plan.workspaces}) n, generate_series(1, 3) m
        where m <= case when n % 3 = 0 then 3 else 2 end
        on conflict do nothing`;
      await tx`
        insert into organization (id, name, slug, kind, is_demo)
        select ('00000000-0000-4000-9' || lpad(to_hex(n), 3, '0') || '-000000000000')::uuid,
               'Scale workspace ' || n || ' (fictional)',
               'demo-scale-' || lpad(n::text, 4, '0'),
               case when n % 3 = 0 then 'chamber' else 'solo' end, true
        from generate_series(1, ${plan.workspaces}) n
        on conflict do nothing`;
      await tx`
        insert into member (id, workspace_id, user_id, role)
        select gen_random_uuid(), o.id, u.id, case when u.email like '%.1@%' then 'advocate' else 'clerk' end
        from organization o
        join "user" u on u.email like 'scale.' || right(o.slug, 4)::int || '.%'
        where o.slug like 'demo-scale-%'
        on conflict do nothing`;
    });
  } finally {
    await sql.end();
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
