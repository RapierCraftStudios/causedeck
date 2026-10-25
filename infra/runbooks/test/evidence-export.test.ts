// evidence-export.sh against a seeded fake Loki: the archive is encrypted, the manifest and hashes
// verify, the contents are the seeded lines, and a non-India destination is refused.
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'runbooks',
  'evidence-export.sh',
);

const SEED_COUNT = 12_000; // more than two 5000-entry pages
const T0 = Date.parse('2026-10-01T00:00:00Z');
const seeded = Array.from({ length: SEED_COUNT }, (_, i) => ({
  ts: String((BigInt(T0) + BigInt(i)) * 1_000_000n),
  line: `seeded line ${i} request_id=r${i}`,
}));

let server: Server;
let lokiUrl = '';
let dir = '';
let keyFile = '';

function run(args: string[], env: Record<string, string>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('bash', [script, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

before(async () => {
  dir = mkdtempSync(path.join(process.env['TMPDIR'] ?? tmpdir(), 'evidence-test-'));
  keyFile = path.join(dir, 'key');
  writeFileSync(keyFile, 'test-passphrase-not-a-secret\n');
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const start = BigInt(url.searchParams.get('start') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? '100');
    const values = seeded
      .filter((e) => BigInt(e.ts) >= start)
      .slice(0, limit)
      .map((e) => [e.ts, e.line]);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        status: 'success',
        data: { resultType: 'streams', result: [{ stream: { service: 'api' }, values }] },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  lokiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

describe('evidence-export.sh', () => {
  it('exports a seeded range into an encrypted archive with a verifiable manifest', async () => {
    const out = path.join(dir, 'out');
    mkdirSync(out);
    const result = await run(
      ['--from', '2026-10-01T00:00:00Z', '--to', '2026-10-02T00:00:00Z', '--out', out],
      { LOKI_URL: lokiUrl, EVIDENCE_KEY_FILE: keyFile },
    );
    assert.equal(result.status, 0, result.stderr);
    const archive = result.stdout.trim();
    const encrypted = readFileSync(archive);
    assert.ok(!encrypted.includes('seeded line'), 'archive must not contain plaintext');

    const manifest = JSON.parse(
      readFileSync(archive.replace('.tar.enc', '.manifest.json'), 'utf8'),
    );
    assert.equal(manifest.entries, SEED_COUNT);
    assert.equal(manifest.archive.sha256, createHash('sha256').update(encrypted).digest('hex'));
    assert.match(readFileSync(`${archive}.sha256`, 'utf8'), new RegExp(manifest.archive.sha256));

    const extract = path.join(dir, 'extract');
    mkdirSync(extract);
    const decrypted = spawnSync(
      'bash',
      [
        '-c',
        `openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"${keyFile}" -in "${archive}" | tar -x -C "${extract}"`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(decrypted.status, 0, decrypted.stderr);
    const logs = readFileSync(path.join(extract, 'logs.ndjson'), 'utf8');
    assert.equal(createHash('sha256').update(logs).digest('hex'), manifest.files[0].sha256);
    const lines = logs
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { line: string });
    assert.equal(lines.length, SEED_COUNT);
    assert.equal(lines[0]?.line, 'seeded line 0 request_id=r0');
    assert.equal(
      lines[SEED_COUNT - 1]?.line,
      `seeded line ${SEED_COUNT - 1} request_id=r${SEED_COUNT - 1}`,
    );
  });

  it('refuses a destination outside India', async () => {
    const result = await run(
      [
        '--from',
        '2026-10-01T00:00:00Z',
        '--to',
        '2026-10-02T00:00:00Z',
        '--out',
        path.join(dir, 'x'),
      ],
      {
        LOKI_URL: lokiUrl,
        EVIDENCE_KEY_FILE: keyFile,
        EVIDENCE_S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
        EVIDENCE_S3_BUCKET: 'b',
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /india-guard/);
  });

  it('requires a key file and a range', async () => {
    const noKey = await run(['--from', 'a', '--to', 'b'], {
      LOKI_URL: lokiUrl,
      EVIDENCE_KEY_FILE: '',
    });
    assert.notEqual(noKey.status, 0);
    const noRange = await run([], { LOKI_URL: lokiUrl, EVIDENCE_KEY_FILE: keyFile });
    assert.notEqual(noRange.status, 0);
  });
});
