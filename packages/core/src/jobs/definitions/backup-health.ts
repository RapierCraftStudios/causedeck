// `system.backup.health` (#101): every minute, read the status reports the backup scripts publish
// to the ops bucket (infra/scripts/backup, infra/scripts/restore), expose them as metrics and log
// an alert-level error for each breach. Alert routing is the monitoring stack (#102): it pages on
// these metrics and on the `backup_alert` log field. The job reads small JSON objects and touches
// no tenant data. Reports: status/archive.json, status/basebackup.json, status/replication.json,
// drills/latest.json, drills/last-success.json. A missing or unreadable report counts as stale.
import { createHash, createHmac } from 'node:crypto';

import { meter } from '@causedeck/observability';
import { z } from 'zod';

import { defineJob } from '../define.ts';

/** 5 minute SLO for the age of the last archived WAL segment. */
export const WAL_ARCHIVE_MAX_AGE_SECONDS = 300;
/** A nightly backup older than 26 hours was missed. */
export const BASE_BACKUP_MAX_AGE_SECONDS = 26 * 3600;
/** The weekly drill is stale after 8 days. */
export const DRILL_MAX_AGE_SECONDS = 8 * 86400;
/** PRD §8: RPO at most 15 minutes, RTO at most 4 hours. */
export const RPO_TARGET_SECONDS = 900;
export const RTO_TARGET_SECONDS = 14_400;
/** The WAL check runs every minute: no report for 10 minutes means the checker itself is down. */
export const ARCHIVE_CHECK_MAX_AGE_SECONDS = 600;

export interface BackupReports {
  archive: { checkedAt?: string; lastArchivedAt?: string; ageSeconds?: number } | null;
  basebackup: { finishedAt?: string; ok?: boolean } | null;
  replication: { finishedAt?: string; ok?: boolean } | null;
  drillLatest: { startedAt?: string; ok?: boolean; rtoSeconds?: number; rpoSeconds?: number } | null;
  drillLastSuccess: { startedAt?: string; rtoSeconds?: number } | null;
}

export interface BackupMetrics {
  walg_last_archive_age_seconds: number;
  walg_last_backup_age_seconds: number;
  restore_drill_last_success_timestamp: number;
  restore_drill_rto_seconds: number;
}

export interface BackupHealth {
  metrics: BackupMetrics;
  /** One human-readable line per breach; empty when healthy. */
  problems: string[];
}

/** Age in seconds of an ISO timestamp, or `Infinity` when absent or unparsable. */
function ageSeconds(iso: string | undefined, now: Date): number {
  const t = iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : Math.max(0, (now.getTime() - t) / 1000);
}

/** Pure evaluation of the reports against the thresholds. Exported for tests. */
export function evaluateBackupHealth(reports: BackupReports, now: Date): BackupHealth {
  const problems: string[] = [];
  const { archive, basebackup, replication, drillLatest, drillLastSuccess } = reports;

  const archiveAge = ageSeconds(archive?.lastArchivedAt, now);
  if (archiveAge > WAL_ARCHIVE_MAX_AGE_SECONDS) {
    problems.push(`stale WAL: last archived segment is ${String(Math.round(archiveAge))}s old`);
  }
  if (ageSeconds(archive?.checkedAt, now) > ARCHIVE_CHECK_MAX_AGE_SECONDS) {
    problems.push('WAL archive check has not reported for 10 minutes');
  }

  const backupAge = ageSeconds(basebackup?.finishedAt, now);
  if (basebackup?.ok === false) problems.push('failed backup: the last base backup run failed');
  if (backupAge > BASE_BACKUP_MAX_AGE_SECONDS) {
    problems.push(`missed backup: last base backup finished ${String(Math.round(backupAge))}s ago`);
  }

  if (replication?.ok === false) problems.push('MinIO replication to the second India location failed');

  if (drillLatest?.ok === false) problems.push('failed drill: the last restore drill did not pass');
  if ((drillLatest?.rpoSeconds ?? 0) > RPO_TARGET_SECONDS) {
    problems.push(`RPO breach: ${String(drillLatest?.rpoSeconds)}s exceeds ${String(RPO_TARGET_SECONDS)}s`);
  }
  if ((drillLatest?.rtoSeconds ?? 0) > RTO_TARGET_SECONDS) {
    problems.push(`RTO breach: ${String(drillLatest?.rtoSeconds)}s exceeds ${String(RTO_TARGET_SECONDS)}s`);
  }
  const drillAge = ageSeconds(drillLastSuccess?.startedAt, now);
  if (drillAge > DRILL_MAX_AGE_SECONDS) problems.push('no successful restore drill in the last 8 days');

  const lastSuccess = Date.parse(drillLastSuccess?.startedAt ?? '');
  return {
    problems,
    metrics: {
      walg_last_archive_age_seconds: Number.isFinite(archiveAge) ? Math.round(archiveAge) : -1,
      walg_last_backup_age_seconds: Number.isFinite(backupAge) ? Math.round(backupAge) : -1,
      restore_drill_last_success_timestamp: Number.isNaN(lastSuccess)
        ? 0
        : Math.floor(lastSuccess / 1000),
      restore_drill_rto_seconds: drillLastSuccess?.rtoSeconds ?? drillLatest?.rtoSeconds ?? -1,
    },
  };
}

/** Reads one JSON object from the ops bucket; `null` when it does not exist or cannot be read. */
export type ReportReader = (key: string) => Promise<unknown>;

export interface OpsBucketConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

/** Config from BACKUP_OPS_* variables (read-only credentials); `null` when not configured. */
export function opsBucketConfigFromEnv(env: NodeJS.ProcessEnv): OpsBucketConfig | null {
  const { BACKUP_OPS_ENDPOINT: endpoint, BACKUP_OPS_ACCESS_KEY: accessKey } = env;
  const secretKey = env.BACKUP_OPS_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) return null;
  return {
    endpoint,
    accessKey,
    secretKey,
    bucket: env.BACKUP_OPS_BUCKET || 'causedeck-ops',
    region: env.BACKUP_OPS_REGION || 'ap-south-1',
  };
}

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();
const sha256Hex = (data: string): string => createHash('sha256').update(data).digest('hex');

/** SigV4 path-style GET of `<bucket>/<key>`; the packages/storage client is workspace-keyed only. */
export function createOpsReportReader(
  config: OpsBucketConfig,
  fetchImpl: typeof fetch = fetch,
  clock: () => Date = () => new Date(),
): ReportReader {
  return async (key) => {
    const url = new URL(`${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${key}`);
    const amzDate = clock().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256Hex('');
    const headers = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signed = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = `GET\n${url.pathname}\n\n${headers}\n${signed}\n${payloadHash}`;
    const scope = `${day}/${config.region}/s3/aws4_request`;
    const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`;
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${config.secretKey}`, day), config.region), 's3'),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
    const response = await fetchImpl(url, {
      headers: {
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  };
}

const KEYS = {
  archive: 'status/archive.json',
  basebackup: 'status/basebackup.json',
  replication: 'status/replication.json',
  drillLatest: 'drills/latest.json',
  drillLastSuccess: 'drills/last-success.json',
} as const;

/** Fetch all five reports; any that cannot be read is `null` (and so counts as stale). */
export async function readBackupReports(read: ReportReader): Promise<BackupReports> {
  const get = async (key: string): Promise<object | null> => {
    try {
      const value = await read(key);
      return typeof value === 'object' && value !== null ? value : null;
    } catch {
      return null;
    }
  };
  const [archive, basebackup, replication, drillLatest, drillLastSuccess] = await Promise.all([
    get(KEYS.archive),
    get(KEYS.basebackup),
    get(KEYS.replication),
    get(KEYS.drillLatest),
    get(KEYS.drillLastSuccess),
  ]);
  return { archive, basebackup, replication, drillLatest, drillLastSuccess } as BackupReports;
}

// Gauges are observable: the latest evaluation is held here and read at each metric collection.
let latest: BackupMetrics | null = null;
let registered = false;

function registerGauges(): void {
  if (registered) return;
  registered = true;
  const m = meter();
  const names: (keyof BackupMetrics)[] = [
    'walg_last_archive_age_seconds',
    'walg_last_backup_age_seconds',
    'restore_drill_last_success_timestamp',
    'restore_drill_rto_seconds',
  ];
  for (const name of names) {
    m.createObservableGauge(name).addCallback((result) => {
      if (latest !== null) result.observe(latest[name]);
    });
  }
}

export interface BackupHealthContext {
  log: {
    info: (fields: object, message: string) => void;
    error: (fields: object, message: string) => void;
    warn: (fields: object, message: string) => void;
  };
}

/** One health pass. Exported for tests; `reader` is `null` when the ops bucket is not configured. */
export async function runBackupHealth(
  ctx: BackupHealthContext,
  reader: ReportReader | null,
  now: Date = new Date(),
): Promise<BackupHealth | null> {
  if (reader === null) {
    ctx.log.warn({ backup_alert: false }, 'backup health not configured: set BACKUP_OPS_* variables');
    return null;
  }
  const health = evaluateBackupHealth(await readBackupReports(reader), now);
  latest = health.metrics;
  registerGauges();
  for (const problem of health.problems) ctx.log.error({ backup_alert: true, problem }, 'backup health');
  if (health.problems.length === 0) ctx.log.info({ ...health.metrics }, 'backup health ok');
  return health;
}

export const backupHealth = defineJob({
  name: 'system.backup.health',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'backup-health', policy: 'stately' },
  schedule: { cron: '* * * * *', payload: {} },
  handler: async (ctx) => {
    const config = opsBucketConfigFromEnv(process.env);
    await runBackupHealth(ctx, config === null ? null : createOpsReportReader(config));
  },
});
