// `pnpm --filter @causedeck/worker jobs:dlq list|show <id>|retry <id>|purge --older-than 30d`
// Inspect and act on dead-lettered jobs. Payloads are shown with content fields redacted: only
// identifiers are printed (PRD §9).
import { pathToFileURL } from 'node:url';

import { serverEnv } from '@causedeck/config/env';
import {
  BANNED_PAYLOAD_FIELDS,
  deadLetterQueue,
  PGBOSS_SCHEMA,
  registry as defaultRegistry,
  type AnyJobDefinition,
} from '@causedeck/core/jobs';
import { CONTENT_KEYS, contentPlaceholder, redactDeep } from '@causedeck/observability';
import { PgBoss, type JobWithMetadata } from 'pg-boss';

export class UsageError extends Error {
  override name = 'UsageError';
}

export const USAGE =
  'usage: jobs:dlq list | show <id> | retry <id> | purge --older-than <N>(d|h|m)';

export type DlqCommand =
  | { cmd: 'list' }
  | { cmd: 'show'; id: string }
  | { cmd: 'retry'; id: string }
  | { cmd: 'purge'; olderThanMs: number };

const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000 } as const;

export function parseDuration(value: string): number {
  const match = /^(\d+)([dhm])$/.exec(value);
  if (match === null) throw new UsageError(`invalid duration "${value}" (use e.g. 30d, 12h, 90m)`);
  const amount = Number(match[1]);
  if (amount <= 0) throw new UsageError('duration must be positive');
  return amount * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}

export function parseArgs(argv: readonly string[]): DlqCommand {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'list':
      return { cmd: 'list' };
    case 'show':
    case 'retry': {
      const id = rest[0];
      if (id === undefined) throw new UsageError(`${cmd} needs a job id`);
      return { cmd, id };
    }
    case 'purge': {
      const flag = rest.findIndex((a) => a === '--older-than' || a.startsWith('--older-than='));
      const raw =
        flag === -1
          ? undefined
          : rest[flag]?.includes('=')
            ? rest[flag].slice('--older-than='.length)
            : rest[flag + 1];
      if (raw === undefined || raw === '') {
        throw new UsageError('refusing to purge without --older-than (e.g. --older-than 30d)');
      }
      return { cmd: 'purge', olderThanMs: parseDuration(raw) };
    }
    default:
      throw new UsageError(USAGE);
  }
}

const HIDDEN_KEYS = new Set([...BANNED_PAYLOAD_FIELDS, ...CONTENT_KEYS]);

const isPlaceholder = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith('[CONTENT_REDACTED:');

function hideContent(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => hideContent(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      HIDDEN_KEYS.has(key) && !isPlaceholder(v) ? contentPlaceholder(v) : hideContent(v, depth + 1),
    ]),
  );
}

/** A DLQ payload safe to print: content fields become placeholders, secrets `[REDACTED]`. */
export function redactPayload(data: unknown): unknown {
  return hideContent(redactDeep(data));
}

export interface DlqEntry {
  queue: string;
  id: string;
  sourceName: string | null;
  sourceId: string | null;
  deadLetteredOn: string;
  attempts: number | null;
  error: unknown;
  payload: unknown;
}

function entryOf(queue: string, job: JobWithMetadata<unknown>): DlqEntry {
  return {
    queue,
    id: job.id,
    sourceName: job.sourceName,
    sourceId: job.sourceId,
    deadLetteredOn: job.createdOn.toISOString(),
    attempts: job.sourceRetryCount === null ? null : job.sourceRetryCount + 1,
    error: redactPayload(job.sourceOutput ?? null),
    payload: redactPayload(job.data),
  };
}

export type DlqBoss = Pick<PgBoss, 'findJobs' | 'redrive' | 'deleteJob'>;

export interface DlqDeps {
  readonly boss: DlqBoss;
  readonly registry: { readonly definitions: readonly AnyJobDefinition[] };
  readonly out: (line: string) => void;
  readonly now?: () => Date;
}

const queuesOf = (deps: DlqDeps): string[] =>
  deps.registry.definitions.map((d) => deadLetterQueue(d.name));

async function allEntries(deps: DlqDeps): Promise<DlqEntry[]> {
  const entries: DlqEntry[] = [];
  for (const queue of queuesOf(deps)) {
    for (const job of await deps.boss.findJobs<unknown>(queue)) entries.push(entryOf(queue, job));
  }
  return entries;
}

async function findEntry(deps: DlqDeps, id: string): Promise<DlqEntry | undefined> {
  for (const queue of queuesOf(deps)) {
    const [job] = await deps.boss.findJobs<unknown>(queue, { id });
    if (job !== undefined) return entryOf(queue, job);
  }
  return undefined;
}

/** Run one command. Returns the process exit code. */
export async function runDlq(command: DlqCommand, deps: DlqDeps): Promise<number> {
  switch (command.cmd) {
    case 'list': {
      const entries = await allEntries(deps);
      for (const e of entries) {
        deps.out(
          `${e.id}  ${e.queue}  dead-lettered ${e.deadLetteredOn}  attempts ${String(e.attempts ?? '?')}`,
        );
      }
      deps.out(`${String(entries.length)} dead-lettered job(s)`);
      return 0;
    }
    case 'show': {
      const entry = await findEntry(deps, command.id);
      if (entry === undefined) {
        deps.out(`no dead-lettered job ${command.id}`);
        return 1;
      }
      deps.out(JSON.stringify(entry, null, 2));
      return 0;
    }
    case 'retry': {
      const entry = await findEntry(deps, command.id);
      if (entry === undefined) {
        deps.out(`no dead-lettered job ${command.id}`);
        return 1;
      }
      const moved = await deps.boss.redrive(entry.queue, { ids: [entry.id] });
      deps.out(
        moved === 1 ? `requeued ${entry.id} to ${entry.sourceName ?? '?'}` : 'nothing requeued',
      );
      return moved === 1 ? 0 : 1;
    }
    case 'purge': {
      const cutoff = (deps.now?.() ?? new Date()).getTime() - command.olderThanMs;
      let purged = 0;
      for (const queue of queuesOf(deps)) {
        const ids = (await deps.boss.findJobs<unknown>(queue))
          .filter((job) => job.createdOn.getTime() < cutoff)
          .map((job) => job.id);
        if (ids.length > 0) {
          await deps.boss.deleteJob(queue, ids);
          purged += ids.length;
        }
      }
      deps.out(`purged ${String(purged)} dead-lettered job(s)`);
      return 0;
    }
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let command: DlqCommand;
  try {
    command = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    return 2;
  }
  const ownerUrl = serverEnv().DATABASE_URL_OWNER;
  if (ownerUrl === undefined) {
    console.error('DATABASE_URL_OWNER is not set: the DLQ CLI runs as the pgboss schema owner.');
    return 2;
  }
  const boss = new PgBoss({
    connectionString: ownerUrl.reveal(),
    schema: PGBOSS_SCHEMA,
    application_name: 'causedeck-dlq-cli',
    migrate: false,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  try {
    return await runDlq(command, {
      boss,
      registry: defaultRegistry,
      out: (line) => {
        console.log(line);
      },
    });
  } finally {
    await boss.stop({ graceful: false });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
