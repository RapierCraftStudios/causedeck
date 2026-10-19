// The `plans` seeder (#200): every profile, idempotent, rows equal to the billing catalogue.
import { PLAN_CATALOGUE } from '@causedeck/billing/plans';
import { Secret } from '@causedeck/config/env';
import { afterEach, describe, expect, it } from 'vitest';

import { createDb } from '../../client.ts';
import { runMigrations } from '../../migrate.ts';
import { createScratchDatabase, testDatabaseUrls } from '../../testing/index.ts';
import { registeredSeeds, SEED_PROFILES, seed } from '../index.ts';
import { PLAN_SEED_NAME } from '../plans.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('plans seed', () => {
  it('is registered first for every profile', () => {
    for (const profile of SEED_PROFILES) {
      const seeds = registeredSeeds(profile);
      expect(seeds[0]?.name, profile).toBe(PLAN_SEED_NAME);
      expect(seeds[0]?.order, profile).toBe(0);
    }
  });

  it('seeds exactly the catalogue, idempotently', async () => {
    const scratch = await createScratchDatabase(testDatabaseUrls(), 'plans_seed');
    cleanups.push(scratch.drop);
    await runMigrations({ url: new Secret(scratch.owner) });
    const db = createDb({ url: new Secret(scratch.app), role: 'app', max: 1 });
    try {
      for (let i = 0; i < 2; i++) await seed(db, { profile: 'test' });
      const rows = await db.$client.unsafe<
        {
          id: string;
          name: string;
          kind: string;
          interval: string;
          price_paise: number;
          per_seat: boolean;
          clerk_seat_price_paise: number | null;
          min_seats: number;
          active: boolean;
        }[]
      >(
        'select id, name, kind, interval, price_paise, per_seat, clerk_seat_price_paise, min_seats, active from plan order by id',
      );
      const expected = PLAN_CATALOGUE.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        interval: p.interval,
        price_paise: p.pricePaise,
        per_seat: p.perSeat,
        clerk_seat_price_paise: p.clerkSeatPricePaise,
        min_seats: p.minSeats,
        active: p.active,
      })).sort((a, b) => (a.id < b.id ? -1 : 1));
      expect(rows.map((r) => ({ ...r }))).toEqual(expected);
    } finally {
      await db.$client.end();
    }
  });
});
