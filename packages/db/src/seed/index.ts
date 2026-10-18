// Seed registry (spike §4.3). Later issues register seeders for their tables; the synthetic,
// court-faithful demo data (two fictional workspaces) arrives with the domain milestones.
import type { Database, Transaction } from '../client.ts';

export const SEED_PROFILES = ['demo', 'test', 'e2e'] as const;
export type SeedProfile = (typeof SEED_PROFILES)[number];

export type SeedDb = Database | Transaction;

export interface Seeder {
  /** Unique, stable name, for logs and ordering ties. */
  name: string;
  profiles: readonly SeedProfile[];
  /** Lower runs first (parents before children). */
  order: number;
  run: (db: SeedDb) => Promise<void>;
}

const registry = new Map<string, Seeder>();

export function registerSeed(seeder: Seeder): void {
  if (registry.has(seeder.name)) throw new Error(`seeder already registered: ${seeder.name}`);
  registry.set(seeder.name, seeder);
}

export function registeredSeeds(profile?: SeedProfile): Seeder[] {
  return [...registry.values()]
    .filter((s) => profile === undefined || s.profiles.includes(profile))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export interface SeedOptions {
  profile: SeedProfile;
}

/** Run every seeder registered for `profile`, in order. Returns the names that ran. */
export async function seed(db: SeedDb, { profile }: SeedOptions): Promise<string[]> {
  const ran: string[] = [];
  for (const seeder of registeredSeeds(profile)) {
    await seeder.run(db);
    ran.push(seeder.name);
  }
  return ran;
}

/** Test hook: forget every registered seeder. */
export function resetSeedRegistry(): void {
  registry.clear();
}
