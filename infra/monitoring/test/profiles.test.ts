// Compose profiles (#886): `core` is lean and still delivers every alert rule; `full` is as before.
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');
const compose = read('compose.monitoring.yml');
const body = compose.slice(compose.indexOf('\nservices:\n') + 1);

interface Svc {
  profiles: string[];
  memMiB: number;
}
const services: Record<string, Svc> = {};
{
  let name = '';
  for (const block of body.split(/\n(?=  [a-z][a-z0-9-]*:\n)/).slice(1)) {
    name = /^ {2}([a-z][a-z0-9-]*):/.exec(block)?.[1] ?? name;
    const profiles = (/^\s{4}profiles: \[([^\]]*)\]/m.exec(block)?.[1] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const mem = /memory: \$\{\w+:-(\d+)([mg])\}|memory: (\d+)([mg])/.exec(block);
    const n = Number(mem?.[1] ?? mem?.[3]);
    const unit = mem?.[2] ?? mem?.[4];
    services[name] = { profiles, memMiB: unit === 'g' ? n * 1024 : n };
  }
}
const inProfile = (p: string) => Object.entries(services).filter(([, s]) => s.profiles.includes(p));

describe('monitoring profiles', () => {
  it('core is Prometheus, Alertmanager, node-exporter, blackbox and cAdvisor', () => {
    assert.deepEqual(
      inProfile('core')
        .map(([n]) => n)
        .sort(),
      ['alertmanager', 'blackbox', 'cadvisor', 'node-exporter', 'prometheus-core'],
    );
  });

  it('core keeps memory limits at 1 GB or less, Prometheus at 512 MB or less', () => {
    const total = inProfile('core').reduce((sum, [, s]) => sum + s.memMiB, 0);
    assert.ok(total <= 1024, `core limits total ${String(total)} MiB`);
    assert.ok((services['prometheus-core'] as Svc).memMiB <= 512);
  });

  it('full is everything it was: the three heavy services plus the shared ones', () => {
    assert.deepEqual(
      inProfile('full')
        .map(([n]) => n)
        .sort(),
      [
        'alertmanager',
        'blackbox',
        'cadvisor',
        'grafana',
        'loki',
        'node-exporter',
        'otel-collector',
        'prometheus',
      ],
    );
    const total = inProfile('full').reduce((sum, [, s]) => sum + s.memMiB, 0);
    assert.equal(total, 2496);
    assert.equal((services.prometheus as Svc).memMiB, 768);
  });

  it('puts no service outside a profile (nothing starts by accident)', () => {
    for (const [name, svc] of Object.entries(services)) {
      assert.ok(svc.profiles.length > 0, `${name} has no profile`);
    }
  });
});

describe('core delivers every alert rule', () => {
  const core = read('prometheus/prometheus.core.yml');
  const jobs = [...core.matchAll(/job_name: (\S+)/g)].map((m) => m[1] as string);
  const rules = ['alerts.yml', 'court-day.yml']
    .map((f) => read(`prometheus/rules/${f}`))
    .join('\n');

  it('evaluates the same rule files as full', () => {
    assert.match(core, /\/etc\/prometheus\/rules\/\*\.yml/);
    assert.match(compose, /prometheus\/rules:\/etc\/prometheus\/rules:ro/);
  });

  it('scrapes every job a rule selects, except those of full-only services', () => {
    const selected = new Set(
      [...rules.matchAll(/job=~?"([^"]+)"/g)].flatMap((m) => (m[1] as string).split('|')),
    );
    const fullOnly = new Set(['otel-collector', 'loki']);
    for (const job of selected) {
      if (fullOnly.has(job)) continue;
      assert.ok(jobs.includes(job), `core does not scrape job ${job}`);
    }
    assert.ok(!jobs.includes('loki') && !jobs.includes('otel-collector'));
  });

  it('receives application metrics (backup and stale-WAL alerts) over OTLP', () => {
    assert.match(rules, /BackupWalStale/);
    assert.match(rules, /BackupBaseStale/);
    assert.match(compose, /--web\.enable-otlp-receiver/);
    assert.match(compose, /aliases: \[prometheus\]/);
  });

  it('has container CPU for DatabaseCpuHigh through cAdvisor', () => {
    assert.match(rules, /container_cpu_usage_seconds_total/);
    assert.ok(jobs.includes('cadvisor'));
  });
});

describe('alertmanager', () => {
  it('can write its rendered config: /tmp is a tmpfs on a read-only root', () => {
    const block = compose.slice(compose.indexOf('\n  alertmanager:\n'));
    const end = block.indexOf('\n  loki:');
    const alertmanager = block.slice(0, end === -1 ? undefined : end);
    assert.match(alertmanager, /read_only: true/);
    assert.match(alertmanager, /tmpfs:\n\s+- \/tmp/);
  });
});
