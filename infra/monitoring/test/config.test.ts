// Static checks for the monitoring stack definition (#102):
//   node --experimental-strip-types --no-warnings --test infra/monitoring/test/
// `docker compose config -q`, promtool and amtool (CI) validate syntax; these assert the rules the
// stack must keep: 180-day India retention, no public ports, bounded resources, redaction parity.
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..', '..');
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');
const compose = read('compose.monitoring.yml');
const loki = read('loki/loki-config.yml');

const servicesText = compose.slice(compose.indexOf('\nservices:\n'));
const services: Record<string, string> = {};
{
  let current = '';
  for (const line of servicesText.split('\n').slice(2)) {
    const head = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (head) {
      current = head[1] as string;
      services[current] = '';
    } else if (current) services[current] += `${line}\n`;
  }
}

describe('Loki retention and residency', () => {
  it('retains at least 180 days (4320h)', () => {
    const hours = Number(/^\s*retention_period:\s*(\d+)h/m.exec(loki)?.[1]);
    assert.ok(hours >= 4320, `retention_period ${String(hours)}h is below 4320h`);
    assert.match(loki, /retention_enabled: true/);
    assert.match(loki, /deletion_mode: disabled/);
  });

  it('stores logs in India: MinIO on the VPS or S3 ap-south-1', () => {
    assert.match(loki, /region: ap-south-1/);
    const endpoint = /endpoint:\s*\$\{LOKI_S3_ENDPOINT\}/.exec(loki);
    assert.ok(endpoint, 'storage endpoint must come from LOKI_S3_ENDPOINT');
    const fallback = /LOKI_S3_ENDPOINT:\s*\$\{LOKI_S3_ENDPOINT:-([^}]+)\}/.exec(compose)?.[1] ?? '';
    const host = fallback.split(':')[0] ?? '';
    const indian = host === 'minio' || /^s3\.ap-south-1\.amazonaws\.com$/.test(host);
    assert.ok(indian, `default storage endpoint ${fallback} is not in India`);
    assert.doesNotMatch(loki, /(us-east|eu-|us-west)-\d/);
  });

  it('locks log objects for at least 180 days', () => {
    const lifecycle = JSON.parse(read('log-retention/lifecycle.json')) as {
      minimumRetentionDays: number;
      objectLock: { mode: string; days: number };
      lifecycle: { Rules: { Expiration: { Days: number } }[] };
    };
    assert.ok(lifecycle.objectLock.days >= 180);
    assert.equal(lifecycle.objectLock.mode, 'COMPLIANCE');
    for (const rule of lifecycle.lifecycle.Rules) assert.ok(rule.Expiration.Days >= 180);
  });
});

describe('monitoring compose', () => {
  it('pins every image to a version and bounds every service', () => {
    const images = [...compose.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((m) => m[1] as string);
    assert.ok(images.length >= 8);
    for (const image of images) {
      const tag = image.split(':')[1] ?? '';
      assert.match(tag, /^v?\d+\.\d+/, `${image} needs a version tag`);
    }
    for (const [name, block] of Object.entries(services)) {
      assert.match(block, /memory: /, `${name} has no memory limit`);
      assert.match(block, /cpus: /, `${name} has no cpu limit`);
    }
  });

  it('publishes ports on 127.0.0.1 only and never publishes Grafana publicly', () => {
    const ports = [...compose.matchAll(/^\s*-\s*'(\S+?:\d+:\d+)'\s*$/gm)].map((m) => m[1] as string);
    assert.ok(ports.length > 0);
    for (const port of ports) assert.ok(port.startsWith('127.0.0.1:'), `${port} must bind loopback`);
    assert.match(services.grafana as string, /'127\.0\.0\.1:3030:3000'/);
    assert.match(services.grafana as string, /GF_AUTH_ANONYMOUS_ENABLED: 'false'/);
  });

  it('runs in UTC and exports host clock offset', () => {
    assert.match(compose, /TZ: UTC/);
    assert.match(services['node-exporter'] as string, /--collector\.timex/);
  });

  it('reads receivers from env and keeps Sentry optional (no DSN needed)', () => {
    for (const variable of ['ONCALL_WEBHOOK_URL', 'FALLBACK_WEBHOOK_URL', 'ALERT_EMAIL_TO']) {
      assert.match(compose, new RegExp(`${variable}: \\$\\{${variable}:-`));
    }
    assert.doesNotMatch(compose, /SENTRY_DSN:\s*\$\{SENTRY_DSN:\?/);
  });

  it('provisions Grafana dashboards as code', () => {
    const dir = path.join(root, 'grafana', 'dashboards');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const required of ['court-day-windows', 'overview', 'adapters', 'database', 'backups', 'caddy', 'host']) {
      assert.ok(files.includes(`${required}.json`), `missing dashboard ${required}`);
    }
    for (const file of files) {
      const dash = JSON.parse(read(`grafana/dashboards/${file}`)) as { uid: string; panels: unknown[] };
      assert.ok(dash.uid && dash.panels.length > 0, `${file} is empty`);
    }
    assert.match(read('grafana/provisioning/dashboards/dashboards.yml'), /disableDeletion: true/);
  });
});

describe('OpenTelemetry collector', () => {
  const collector = read('otel-collector.yml');

  it('deletes every content key that packages/observability redacts', () => {
    const source = readFileSync(path.join(repo, 'packages/observability/src/redact.ts'), 'utf8');
    const block = /CONTENT_KEYS: readonly string\[\] = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const keys = [...block.matchAll(/'(\w+)'/g)].map((m) => m[1] as string);
    assert.ok(keys.includes('title') && keys.includes('filename') && keys.includes('email'));
    for (const key of [...keys, 'token', 'authorization']) {
      assert.match(collector, new RegExp(`key: ${key}, action: delete`), `${key} not redacted`);
    }
  });

  it('receives OTLP gRPC and HTTP and ships logs only to Loki on the private network', () => {
    assert.match(collector, /endpoint: 0\.0\.0\.0:4317/);
    assert.match(collector, /endpoint: 0\.0\.0\.0:4318/);
    assert.match(collector, /endpoint: http:\/\/loki:3100\/otlp/);
    assert.doesNotMatch(collector, /https?:\/\/(?!loki)[a-z0-9.-]+\.(com|io|net)/);
  });

  it('keeps Caddy credentials out of the log pipeline', () => {
    assert.match(collector, /request\.headers\.Authorization, action: delete/);
    assert.match(collector, /request\.headers\.Cookie, action: delete/);
  });
});
