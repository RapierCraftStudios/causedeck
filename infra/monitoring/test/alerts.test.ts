// Static checks for the alerting config (#102):
//   node --experimental-strip-types --no-warnings --test infra/monitoring/test/
// promtool evaluates the rules in CI (.github/workflows/monitoring.yml); these tests keep the rule
// files, the promtool cases and the Alertmanager routes consistent without needing the tools.
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');
const alerts = read('prometheus/rules/alerts.yml');
const courtDay = read('prometheus/rules/court-day.yml');
const promtool = read('prometheus/tests/alerts.test.yml');
const alertmanager = read('alertmanager/alertmanager.yml');

const ruleNames = (text: string): string[] =>
  [...text.matchAll(/^\s+- alert: (\w+)$/gm)].map((match) => match[1] as string);

const REQUIRED = [
  'ServiceDown',
  'ReadyzFailing',
  'ApiLatencyP95High',
  'DatabaseCpuHigh',
  'DiskUsageHigh',
  'QueueLagHigh',
  'DeadLetterGrowth',
  'BackupWalStale',
  'BackupBaseStale',
  'RestoreDrillFailed',
  'CertificateExpiringSoon',
  'ErrorRateSpike',
  'ClockDriftHigh',
];

describe('alert rules', () => {
  it('define every required alert with the specified thresholds', () => {
    const names = ruleNames(alerts);
    for (const name of REQUIRED) assert.ok(names.includes(name), `missing alert ${name}`);
    const rule = (name: string): string =>
      alerts.slice(alerts.indexOf(`alert: ${name}`)).split('- alert:')[0] as string;
    assert.match(rule('ServiceDown'), /for: 5m/);
    assert.match(rule('ApiLatencyP95High'), /> 400\s+for: 10m/);
    assert.match(rule('DatabaseCpuHigh'), /> 0\.6\s+for: 15m/);
    assert.match(rule('DiskUsageHigh'), /> 0\.8/);
    assert.match(rule('BackupWalStale'), /> 300/);
    assert.match(rule('BackupBaseStale'), /26 \* 3600/);
    assert.match(rule('CertificateExpiringSoon'), /14 \* 86400/);
    assert.match(rule('ClockDriftHigh'), /> 1\s+for: 2m/);
  });

  it('give every alert a severity, a priority and a promtool case', () => {
    const names = [...ruleNames(alerts), ...ruleNames(courtDay)];
    assert.equal((alerts.match(/severity: (page|ticket|info)/g) ?? []).length, ruleNames(alerts).length);
    assert.equal((courtDay.match(/severity: page/g) ?? []).length, ruleNames(courtDay).length);
    for (const name of names) {
      assert.match(promtool, new RegExp(`alertname: ${name}$`, 'm'), `no promtool case for ${name}`);
    }
  });
});

describe('court-day windows', () => {
  it('cover 07:00-10:30 and 18:00-23:00 IST as UTC minutes of the day', () => {
    // 07:00 IST = 01:30 UTC = minute 90; 10:30 IST = 05:00 UTC = 300; 18:00 IST = 12:30 UTC = 750; 23:00 IST = 17:30 UTC = 1050.
    for (const bound of ['>= bool 90', '< bool 300', '>= bool 750', '< bool 1050']) {
      assert.ok(courtDay.includes(bound), `window bound ${bound} missing`);
    }
  });

  it('are stricter than the all-day thresholds', () => {
    assert.match(courtDay, /> 250\)/);
    assert.match(courtDay, /> 60\)/);
    assert.match(alerts, /> 400\n/);
    assert.match(alerts, /> 300\n/);
  });
});

describe('alertmanager routing', () => {
  it('sends P0 and P1 to the on-call receiver and the fallback receiver', () => {
    assert.match(alertmanager, /matchers: \['priority=~"P0\|P1"'\]\n\s+receiver: oncall/);
    assert.match(alertmanager, /receiver: oncall[\s\S]*?continue: true/);
    assert.match(alertmanager, /matchers: \['priority=~"P0\|P1"'\]\n\s+receiver: fallback/);
    assert.match(alertmanager, /name: oncall\n\s+webhook_configs:\n\s+- url: '__ONCALL_WEBHOOK_URL__'/);
    assert.match(alertmanager, /name: fallback\n\s+email_configs:/);
  });

  it('mutes by IST time of day on the ticket and info routes only, never on P0/P1', () => {
    assert.match(alertmanager, /location: Asia\/Kolkata/);
    const routes = alertmanager.slice(alertmanager.indexOf('  routes:'), alertmanager.indexOf('receivers:'));
    const blocks = routes.split(/\n {4}- matchers:/).slice(1);
    assert.ok(blocks.length >= 4);
    for (const block of blocks) {
      if (block.includes('P0')) assert.doesNotMatch(block, /mute_time_intervals/);
      else assert.match(block, /mute_time_intervals: \[night-ist\]/);
    }
    assert.doesNotMatch(alertmanager, /active_time_intervals/);
  });

  it('only inhibits with a rule that cannot hide a P0 alert', () => {
    assert.doesNotMatch(alertmanager, /target_matchers:.*priority/);
    assert.match(alertmanager, /target_matchers: \['alertname="ReadyzFailing"'\]/);
  });
});
