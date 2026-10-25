// Static checks for the deploy workflows (#100): `node --test infra/scripts/`. Plain-text checks, no
// YAML parser at the root; actionlint (lint-workflows.yml) covers syntax.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const wf = (name) => read(`.github/workflows/${name}`);
const WORKFLOWS = [
  'deploy-staging.yml',
  'deploy-prod.yml',
  'hotfix-prod.yml',
  'freeze-warning.yml',
  'deploy-test.yml',
];

/** Body of the job `name` (up to the next top-level job). */
function job(text, name) {
  const start = text.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `job ${name} missing`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('hardening (all deploy workflows)', () => {
  for (const name of WORKFLOWS) {
    const text = wf(name);
    it(`${name}: actions pinned by sha, no credential persistence`, () => {
      for (const line of text.split('\n').filter((l) => /^\s*-?\s*uses:\s/.test(l))) {
        if (/uses:\s*\.\//.test(line)) continue;
        assert.match(line, /@[0-9a-f]{40}\b/, line);
      }
      const checkouts = text.match(/actions\/checkout@/g)?.length ?? 0;
      assert.equal(text.match(/persist-credentials: false/g)?.length ?? 0, checkouts);
      assert.match(text, /^permissions:\n {2}contents: read/m);
    });
  }
});

describe('R2: production deploy is blocked by the freeze before SSH', () => {
  const prod = wf('deploy-prod.yml');
  it('freeze is the first job and promotion depends on it', () => {
    assert.ok(prod.indexOf('\n  freeze:\n') < prod.indexOf('\n  promote:\n'));
    assert.match(job(prod, 'freeze'), /uses: \.\/\.github\/actions\/freeze-guard\n/);
    assert.match(job(prod, 'promote'), /needs: freeze/);
    assert.match(job(prod, 'deploy'), /needs: promote/);
  });
  it('the freeze job has no override and no SSH', () => {
    const freeze = job(prod, 'freeze');
    assert.doesNotMatch(freeze, /allow_override/);
    assert.doesNotMatch(freeze, /remote-deploy|ssh/i);
  });
  it('production deploys run in the production environment with promotion', () => {
    assert.match(job(prod, 'deploy'), /environment: production/);
    assert.match(job(prod, 'promote'), /check-promotion\.sh/);
  });
});

describe('R3: staging', () => {
  const staging = wf('deploy-staging.yml');
  it('runs on push to staging, records but does not enforce the freeze', () => {
    assert.match(staging, /push:\n\s+branches: \[staging\]/);
    assert.match(staging, /allow_override: 'true'/);
    assert.match(staging, /environment: staging/);
  });
  it('builds through images.yml', () =>
    assert.match(staging, /uses: \.\/\.github\/workflows\/images\.yml/));
});

describe('R8: hotfix', () => {
  const hotfix = wf('hotfix-prod.yml');
  it('runs in the hotfix environment, requires a reason, audits and notifies', () => {
    assert.match(job(hotfix, 'authorize'), /environment: hotfix/);
    assert.match(hotfix, /reason:\n[\s\S]*?required: true/);
    assert.match(hotfix, /a non-empty reason is required/);
    assert.match(hotfix, /gh issue comment/);
    assert.match(hotfix, /SLACK_WEBHOOK_URL/);
  });
  it('the override is only used by the hotfix path (and recorded on staging)', () => {
    assert.match(hotfix, /allow_override: 'true'/);
    assert.doesNotMatch(wf('deploy-prod.yml'), /allow_override/);
  });
});

describe('R11: pinned host key', () => {
  const script = read('infra/scripts/remote-deploy.sh');
  it('verifies the host key strictly', () => {
    assert.match(script, /StrictHostKeyChecking=yes/);
    assert.match(script, /UserKnownHostsFile=/);
    assert.doesNotMatch(script, /StrictHostKeyChecking=(no|accept-new)/);
    assert.doesNotMatch(script, /ssh-keyscan/);
  });
  for (const name of ['deploy-staging.yml', 'deploy-prod.yml', 'hotfix-prod.yml']) {
    it(`${name}: secrets come from a GitHub environment`, () => {
      const text = wf(name);
      assert.match(text, /DEPLOY_KNOWN_HOSTS: \$\{\{ secrets\.DEPLOY_KNOWN_HOSTS \}\}/);
      assert.match(text, /DEPLOY_SSH_KEY: \$\{\{ secrets\.DEPLOY_SSH_KEY \}\}/);
      assert.match(text, /GHCR_PULL_TOKEN: \$\{\{ secrets\.GHCR_PULL_TOKEN \}\}/);
      assert.match(text, /environment: (staging|production)/);
    });
  }
});

describe('R13: freeze warning', () => {
  const text = wf('freeze-warning.yml');
  it('is scheduled and targets deploy:prod PRs using the shared freeze logic', () => {
    assert.match(text, /schedule:\n\s+- cron:/);
    assert.match(text, /--label 'deploy:prod'/);
    assert.match(text, /freeze-guard\/freeze\.ts/);
  });
});
