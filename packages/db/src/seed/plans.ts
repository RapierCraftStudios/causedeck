// The `plans` seed (#200): the plan catalogue from `@causedeck/validators/plans`, in every profile and
// before any workspace data. Upserts by id, so re-seeding is idempotent and a price edited in the
// catalogue reaches the table.
import { PLAN_CATALOGUE } from '@causedeck/validators/plans';
import { sql } from 'drizzle-orm';

import { plan } from '../schema/billing.ts';

import { registerSeed, type SeedDb } from './index.ts';

export const PLAN_SEED_NAME = 'plans';

export async function seedPlans(db: SeedDb): Promise<void> {
  // `limits` lives in the catalogue only; the remaining fields are the table's columns.
  const rows = PLAN_CATALOGUE.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    interval: p.interval,
    pricePaise: p.pricePaise,
    perSeat: p.perSeat,
    clerkSeatPricePaise: p.clerkSeatPricePaise,
    minSeats: p.minSeats,
    active: p.active,
  }));
  await db
    .insert(plan)
    .values(rows)
    .onConflictDoUpdate({
      target: plan.id,
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        interval: sql`excluded.interval`,
        pricePaise: sql`excluded.price_paise`,
        perSeat: sql`excluded.per_seat`,
        clerkSeatPricePaise: sql`excluded.clerk_seat_price_paise`,
        minSeats: sql`excluded.min_seats`,
        active: sql`excluded.active`,
      },
    });
}

registerSeed({ name: PLAN_SEED_NAME, profiles: ['demo', 'test', 'e2e'], order: 0, run: seedPlans });
