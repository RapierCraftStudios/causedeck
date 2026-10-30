// Trivy configuration (#104): config pinned to CRITICAL with fixes, every ignore entry expires, and
// images.yml uses the config.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const config = read('./trivy.yaml');
const ignore = read('./.trivyignore.yaml');
const images = read('../../../.github/workflows/images.yml');
const security = read('../../../.github/workflows/security.yml');

/** Entries of the ignore file as `{ id, expired_at }`; the file is a flat list. */
export function ignoreEntries(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const id = /^\s*-\s+id:\s*(\S+)/.exec(line);
    if (id) entries.push({ id: id[1] });
    const expiry = /^\s+expired_at:\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (expiry && entries.length > 0) entries.at(-1).expired_at = expiry[1];
  }
  return entries;
}

describe('trivy config', () => {
  it('fails on critical vulnerabilities that have a fix', () => {
    assert.match(config, /severity:\s*\n\s*-\s*CRITICAL\s*\n/);
    assert.match(config, /^ignore-unfixed: true$/m);
    assert.match(config, /^exit-code: 1$/m);
    assert.match(config, /^ignorefile: \.trivyignore\.yaml$/m);
  });

  it('requires every ignore entry to carry a future expiry within 90 days', () => {
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    for (const entry of ignoreEntries(ignore)) {
      assert.ok(entry.expired_at, `${entry.id} has no expired_at`);
      assert.ok(entry.expired_at >= today, `${entry.id} expired on ${entry.expired_at}`);
      assert.ok(entry.expired_at <= limit, `${entry.id} expires more than 90 days ahead`);
    }
  });

  it('rejects an entry without an expiry (parser sanity)', () => {
    assert.deepEqual(ignoreEntries('vulnerabilities:\n  - id: CVE-1\n    statement: x\n'), [
      { id: 'CVE-1' },
    ]);
  });
});

describe('workflows', () => {
  it('images.yml scans with the shared config and fails on findings', () => {
    assert.match(images, /infra\/security\/trivy/);
    assert.match(images, /--config \/trivy\/trivy\.yaml/);
    assert.match(images, /--exit-code 1/);
    assert.match(images, /--severity CRITICAL/);
  });

  it('security.yml runs a Trivy filesystem scan with the same config', () => {
    assert.match(security, /--config \/trivy\/trivy\.yaml/);
    assert.match(security, /trivy fs|fs --/);
  });

  it('pins the Trivy image by digest', () => {
    assert.match(images, /TRIVY_IMAGE: aquasec\/trivy:[\d.]+@sha256:[0-9a-f]{64}/);
  });
});
