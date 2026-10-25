// `system.backup.health` (#101): thresholds, metrics and the SigV4 reader, with injected reports.
import { describe, expect, it, vi } from 'vitest';

import { registry } from '../registry.ts';
import {
  backupHealth,
  createOpsReportReader,
  evaluateBackupHealth,
  opsBucketConfigFromEnv,
  readBackupReports,
  runBackupHealth,
  type BackupReports,
} from './backup-health.ts';

const NOW = new Date('2026-10-25T12:00:00Z');
const ago = (seconds: number): string => new Date(NOW.getTime() - seconds * 1000).toISOString();

const healthy = (): BackupReports => ({
  archive: { checkedAt: ago(30), lastArchivedAt: ago(45) },
  basebackup: { finishedAt: ago(3600), ok: true },
  replication: { finishedAt: ago(3600), ok: true },
  drillLatest: { startedAt: ago(86400), ok: true, rtoSeconds: 1200, rpoSeconds: 60 },
  drillLastSuccess: { startedAt: ago(86400), rtoSeconds: 1200 },
});

describe('evaluateBackupHealth', () => {
  it('reports no problems and the four metrics when everything is fresh', () => {
    const { problems, metrics } = evaluateBackupHealth(healthy(), NOW);
    expect(problems).toEqual([]);
    expect(metrics).toEqual({
      walg_last_archive_age_seconds: 45,
      walg_last_backup_age_seconds: 3600,
      restore_drill_last_success_timestamp: Math.floor(Date.parse(ago(86400)) / 1000),
      restore_drill_rto_seconds: 1200,
    });
  });

  it('flags stale WAL above 5 minutes', () => {
    const reports = healthy();
    reports.archive = { checkedAt: ago(10), lastArchivedAt: ago(301) };
    expect(evaluateBackupHealth(reports, NOW).problems.join()).toMatch(/stale WAL/);
  });

  it('flags a failed or missed backup', () => {
    const failed = healthy();
    failed.basebackup = { finishedAt: ago(60), ok: false };
    expect(evaluateBackupHealth(failed, NOW).problems.join()).toMatch(/failed backup/);
    const missed = healthy();
    missed.basebackup = { finishedAt: ago(27 * 3600), ok: true };
    expect(evaluateBackupHealth(missed, NOW).problems.join()).toMatch(/missed backup/);
  });

  it('flags a failed drill and RPO/RTO breaches', () => {
    const reports = healthy();
    reports.drillLatest = { startedAt: ago(10), ok: false, rtoSeconds: 14_401, rpoSeconds: 901 };
    const text = evaluateBackupHealth(reports, NOW).problems.join();
    expect(text).toMatch(/failed drill/);
    expect(text).toMatch(/RPO breach/);
    expect(text).toMatch(/RTO breach/);
  });

  it('treats missing reports as stale with sentinel metrics', () => {
    const { problems, metrics } = evaluateBackupHealth(
      {
        archive: null,
        basebackup: null,
        replication: null,
        drillLatest: null,
        drillLastSuccess: null,
      },
      NOW,
    );
    expect(problems.join()).toMatch(/stale WAL/);
    expect(problems.join()).toMatch(/no successful restore drill/);
    expect(metrics.walg_last_archive_age_seconds).toBe(-1);
    expect(metrics.restore_drill_last_success_timestamp).toBe(0);
  });
});

describe('runBackupHealth', () => {
  const ctx = () => ({ log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } });

  it('logs one alert-level error per breach', async () => {
    const c = ctx();
    const reports: Record<string, unknown> = {
      'status/archive.json': { checkedAt: ago(5), lastArchivedAt: ago(900) },
    };
    const health = await runBackupHealth(c, (key) => Promise.resolve(reports[key] ?? null), NOW);
    expect(health?.problems.length).toBeGreaterThan(1);
    expect(c.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ backup_alert: true }),
      'backup health',
    );
  });

  it('logs info when healthy and warns without a reader', async () => {
    const c = ctx();
    const map: Record<string, unknown> = {
      'status/archive.json': healthy().archive,
      'status/basebackup.json': healthy().basebackup,
      'status/replication.json': healthy().replication,
      'drills/latest.json': healthy().drillLatest,
      'drills/last-success.json': healthy().drillLastSuccess,
    };
    await runBackupHealth(c, (key) => Promise.resolve(map[key] ?? null), NOW);
    expect(c.log.error).not.toHaveBeenCalled();
    expect(c.log.info).toHaveBeenCalled();
    expect(await runBackupHealth(c, null, NOW)).toBeNull();
    expect(c.log.warn).toHaveBeenCalled();
  });

  it('survives a reader that throws', async () => {
    const reports = await readBackupReports(() => Promise.reject(new Error('down')));
    expect(reports.archive).toBeNull();
  });
});

describe('ops bucket reader', () => {
  it('needs endpoint and both keys, with India defaults for bucket and region', () => {
    expect(opsBucketConfigFromEnv({})).toBeNull();
    expect(
      opsBucketConfigFromEnv({
        BACKUP_OPS_ENDPOINT: 'http://minio:9000',
        BACKUP_OPS_ACCESS_KEY: 'a',
        BACKUP_OPS_SECRET_KEY: 's',
      }),
    ).toMatchObject({ bucket: 'causedeck-ops', region: 'ap-south-1' });
  });

  it('signs a path-style GET and returns null on a non-2xx', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{"ok":true}')));
    const read = createOpsReportReader(
      {
        endpoint: 'http://minio:9000',
        bucket: 'causedeck-ops',
        region: 'ap-south-1',
        accessKey: 'a',
        secretKey: 's',
      },
      fetchImpl,
      () => NOW,
    );
    expect(await read('status/archive.json')).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://minio:9000/causedeck-ops/status/archive.json');
    expect(JSON.stringify(init.headers)).toMatch(
      /AWS4-HMAC-SHA256 Credential=a\/20261025\/ap-south-1\/s3/,
    );
    const missing = createOpsReportReader(
      {
        endpoint: 'http://minio:9000',
        bucket: 'b',
        region: 'ap-south-1',
        accessKey: 'a',
        secretKey: 's',
      },
      () => Promise.resolve(new Response('', { status: 404 })),
    );
    expect(await missing('x')).toBeNull();
  });
});

describe('definition', () => {
  it('is a registered every-minute system job', () => {
    expect(backupHealth.name).toBe('system.backup.health');
    expect(backupHealth.schedule?.cron).toBe('* * * * *');
    expect(registry.definitions).toContain(backupHealth);
  });
});
