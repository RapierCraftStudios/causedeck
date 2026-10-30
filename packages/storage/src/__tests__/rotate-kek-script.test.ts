// infra/scripts/runbooks/rotate-kek.sh (#103) against staging-like data in a scratch database:
// several workspaces with encrypted documents, rotate kek-1 -> kek-2 through the script, then every
// document still decrypts under the new KEK and a provider with only the old KEK is rejected.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Secret } from '@causedeck/config/env';
import { workspaceKey } from '@causedeck/db/schema';
import {
  createDb,
  createScratchDatabase,
  inWorkspace,
  testDatabaseUrls,
} from '@causedeck/db/testing';
import type { Database } from '@causedeck/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  decryptForWorkspace,
  encryptForWorkspace,
  EnvKeyProvider,
  getWorkspaceDek,
  kekFromBase64,
} from '../index.ts';

import { collect, newWorkspace, rejection } from './workspace-fixtures.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const script = path.join(repoRoot, 'infra/scripts/runbooks/rotate-kek.sh');

const oldB64 = randomBytes(32).toString('base64');
const newB64 = randomBytes(32).toString('base64');
const oldProvider = new EnvKeyProvider([kekFromBase64('kek-1', oldB64)]);
const newProvider = new EnvKeyProvider([kekFromBase64('kek-2', newB64)]);

let drop: () => Promise<void> = () => Promise.resolve();
let appUrl = '';
let db: Database;

function rotate(args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync('bash', [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      // eslint-disable-next-line no-process-env -- the child needs PATH and the pnpm environment
      ...process.env,
      DATABASE_URL: appUrl,
      KEK_NEW_BASE64: newB64,
      KEK_OLD_BASE64: oldB64,
      ...env,
    },
  });
}

beforeAll(async () => {
  const scratch = await createScratchDatabase(testDatabaseUrls(), 'rotate_kek_script');
  drop = scratch.drop;
  appUrl = scratch.app;
  const migrate = spawnSync('pnpm', ['--filter', '@causedeck/db', 'db:migrate'], {
    cwd: repoRoot,
    encoding: 'utf8',
    // eslint-disable-next-line no-process-env -- the child needs PATH and the pnpm environment
    env: { ...process.env, DATABASE_URL_OWNER: scratch.owner },
  });
  if (migrate.status !== 0) throw new Error(`migration failed: ${migrate.stderr.slice(-400)}`);
  db = createDb({ url: new Secret(appUrl), role: 'app', max: 2 });
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await drop();
});

describe('rotate-kek.sh', () => {
  it('re-wraps every DEK; documents still decrypt and the old KEK is rejected', async () => {
    const plaintext = randomBytes(80_000);
    const docs = new Map<string, Buffer>();
    const workspaces: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const ws = await db.transaction((tx) => newWorkspace(tx));
      workspaces.push(ws);
      docs.set(ws, await collect(await encryptForWorkspace(db, oldProvider, ws, [plaintext])));
    }

    const dry = rotate(['--dry-run']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout.trim().split('\n').pop() ?? '{}')).toMatchObject({ pending: 3 });

    const result = rotate();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}')).toEqual({
      newKekId: 'kek-2',
      rewrapped: 3,
      remaining: 0,
    });
    expect(result.stdout + result.stderr).not.toContain(newB64);

    for (const ws of workspaces) {
      const [row] = await db.transaction((tx) =>
        inWorkspace(tx, ws, (s) =>
          s.select().from(workspaceKey).where(eq(workspaceKey.workspaceId, ws)),
        ),
      );
      expect(row?.kekId).toBe('kek-2');
      // The new KEK alone decrypts every document; objects were not rewritten.
      const out = await collect(
        decryptForWorkspace(db, newProvider, ws, [docs.get(ws) ?? Buffer.alloc(0)]),
      );
      expect(out.equals(plaintext)).toBe(true);
      // The old KEK is rejected.
      expect((await rejection(getWorkspaceDek(db, oldProvider, ws))).code).toBe('UNKNOWN_KEK');
    }

    // Idempotent rerun.
    expect(JSON.parse(rotate().stdout.trim().split('\n').pop() ?? '{}')).toMatchObject({
      rewrapped: 0,
      remaining: 0,
    });
  }, 180_000);

  it('refuses to run without the keys or with identical keys', () => {
    expect(rotate([], { KEK_OLD_BASE64: '' }).status).toBe(2);
    expect(rotate([], { KEK_OLD_BASE64: newB64 }).status).toBe(2);
  });
});
