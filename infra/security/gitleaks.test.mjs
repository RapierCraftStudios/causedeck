// Gitleaks wiring (#104): example env files are allow-listed explicitly and nothing else is, the
// pre-commit hook runs gitleaks, and the security workflow proves the scanner fails on a seeded secret.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const toml = read('../../.gitleaks.toml');
const lefthook = read('../../lefthook.yml');
const security = read('../../.github/workflows/security.yml');

const pathsBlock = /^paths = \[([\s\S]*?)\n\]/m.exec(toml)?.[1] ?? '';
const patterns = [...pathsBlock.matchAll(/'''(.+?)'''/g)].map((m) => new RegExp(m[1]));
const allowed = (file) => patterns.some((re) => re.test(file));

describe('.gitleaks.toml path allowlist', () => {
  it('covers each example and CI env file and the fixture directory', () => {
    for (const file of [
      '.env.example',
      '.env.ci',
      'infra/docker/env/prod.env.example',
      'infra/docker/env/staging.env.example',
      'infra/security/gitleaks/fixtures/seeded-secret.txt',
    ]) {
      assert.ok(allowed(file), `${file} should be allow-listed`);
    }
  });

  it('does not cover real env files or other paths', () => {
    for (const file of [
      '.env',
      '.env.local',
      '.env.production',
      'apps/web/.env.example',
      'infra/docker/env/prod.env',
      'infra/docker/env/prod.env.example.bak',
      'infra/docker/env/sub/x.env.example',
      'src/secrets.ts',
      'infra/security/gitleaks/fixtures/other.txt',
    ]) {
      assert.ok(!allowed(file), `${file} must not be allow-listed`);
    }
  });
});

describe('hooks and workflow', () => {
  it('lefthook runs gitleaks on staged changes with the repo config', () => {
    assert.match(lefthook, /^\s+gitleaks:\s*$/m);
    assert.match(lefthook, /gitleaks git --staged[^\n]*--config \.gitleaks\.toml/);
    assert.match(lefthook, /ghcr\.io\/gitleaks\/gitleaks@sha256:[0-9a-f]{64}/);
  });

  it('security.yml scans history and proves the scanner fails on a seeded secret', () => {
    assert.match(security, /seeded-secret\.txt/);
    assert.match(security, /seeded secret/i);
  });

  it('the seeded fixture holds a placeholder, never a real token', () => {
    const fixture = read('./gitleaks/fixtures/seeded-secret.txt');
    assert.match(fixture, /@@RANDOM36@@/);
    assert.doesNotMatch(fixture, /ghp_[A-Za-z0-9]{36}/);
  });
});
