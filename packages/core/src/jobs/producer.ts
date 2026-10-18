// Send-only pg-boss client for producers (web, api, worker). It connects as the app role and never
// migrates, supervises or schedules: the worker owns the `pgboss` schema (docs/engineering/jobs.md).
import { serverEnv } from '@causedeck/config/env';
import { createLogger } from '@causedeck/observability';
import { PgBoss, type SendOptions } from 'pg-boss';

export const PGBOSS_SCHEMA = 'pgboss';

/** What `enqueue` needs from pg-boss; tests pass a real instance or a stub. */
export interface JobSender {
  send(name: string, data: object, options?: SendOptions): Promise<string | null>;
}

let producer: Promise<PgBoss> | undefined;

export function createProducer(connectionString: string): PgBoss {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: 'causedeck-producer',
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    max: 4,
  });
}

/** The process-wide producer on `DATABASE_URL`, started on first use. */
export function getProducer(): Promise<JobSender> {
  producer ??= (async () => {
    const boss = createProducer(serverEnv().DATABASE_URL.reveal());
    // pg-boss emits pool errors as events; without a listener they would crash the process.
    const log = createLogger({ service: 'jobs-producer' });
    boss.on('error', (err) => {
      log.error({ err }, 'pg-boss producer error');
    });
    await boss.start();
    return boss;
  })();
  return producer;
}

export async function closeProducer(): Promise<void> {
  const current = producer;
  producer = undefined;
  await (await current)?.stop({ graceful: false });
}
