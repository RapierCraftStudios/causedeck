// Guards the CI shape of the e2e ship gate (#1155): one Playwright worker per runner, the load spread
// over six shards, and no extra retries, longer timeout or larger summed flaky budget to hide stalls.
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

const workflow = readFileSync(
  new URL('../../../.github/workflows/e2e.yml', import.meta.url),
  'utf8',
);

async function loadConfig(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  const { default: config } = await import('../../playwright.config.ts');
  return config;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('e2e CI shape (#1155)', () => {
  it('runs one worker per CI runner with the 30 s timeout and one retry unchanged', async () => {
    const config = await loadConfig({ CI: 'true', E2E_SCOPE: 'ship', E2E_PERF: 'skip' });
    expect(config.workers).toBe(1);
    expect(config.timeout).toBe(30_000);
    expect(config.retries).toBe(1);
    expect(config.fullyParallel).toBe(true);
  });

  it('keeps half the cores and no retries locally', async () => {
    const config = await loadConfig({ CI: '', E2E_SCOPE: 'ship', E2E_PERF: 'skip' });
    expect(config.workers).toBe('50%');
    expect(config.retries).toBe(0);
  });

  it('shards the ship scope six ways behind an aggregate e2e check', () => {
    expect(workflow).toMatch(/^ {2}e2e-shard:\n {4}name: e2e \(\$\{\{ matrix\.shard \}\}\/6\)$/m);
    expect(workflow).toContain('shard: [1, 2, 3, 4, 5, 6]');
    expect(workflow).toContain('--shard="$SHARD/6"');
    expect(workflow).not.toMatch(/--shard="\$SHARD\/2"|\}\}\/2\)/);
    expect(workflow).toMatch(/^ {2}e2e:\n {4}name: e2e\n {4}needs: e2e-shard$/m);
    expect(workflow).toContain('SHARDS_RESULT: ${{ needs.e2e-shard.result }}');
  });

  it('does not raise the summed flaky budget across shards', () => {
    const match = workflow.match(
      /E2E_FLAKY_BUDGET: \$\{\{ github\.event_name == 'pull_request' && '(\d+)' \|\| '(\d+)' \}\}/,
    );
    expect(match).not.toBeNull();
    const [, pr, push] = match ?? [];
    // Six shards; the two-shard budget was 25 (PR) and 30 (push) per shard: 50 and 60 in total.
    expect(Number(pr) * 6).toBeLessThanOrEqual(50);
    expect(Number(push) * 6).toBeLessThanOrEqual(60);
  });
});
