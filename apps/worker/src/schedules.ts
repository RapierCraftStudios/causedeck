// Cron schedules (spike §1). pg-boss stores schedules in its own table and a single instance sends
// each occurrence, so every replica can call this on boot without double-sending.
import type { AnyJobDefinition } from '@causedeck/core/jobs';
import type { PgBoss } from 'pg-boss';

export const SCHEDULE_TIMEZONE = 'Asia/Kolkata';

export async function registerSchedules(
  boss: PgBoss,
  registry: { readonly definitions: readonly AnyJobDefinition[] },
): Promise<string[]> {
  const registered: string[] = [];
  for (const def of registry.definitions) {
    if (def.schedule === undefined) continue;
    const payload = def.schema.parse(def.schedule.payload) as object;
    await boss.schedule(def.name, def.schedule.cron, payload, { tz: SCHEDULE_TIMEZONE });
    registered.push(def.name);
  }
  return registered;
}
