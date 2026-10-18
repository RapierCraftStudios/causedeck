import { fileURLToPath } from 'node:url';

import { closeTestDb } from '@causedeck/db/testing';
import { build } from 'esbuild';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { authRequest, devSignInAs, makeAuth, uniqueEmail } from './helpers';

afterAll(closeTestDb);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const SERVER_ENTRY = fileURLToPath(new URL('../server.ts', import.meta.url));

/** Bundle `server.ts` the way a production build would and return the output text. */
async function bundleServer(nodeEnv: string): Promise<string> {
  const result = await build({
    entryPoints: [SERVER_ENTRY],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    minifySyntax: true,
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
    logLevel: 'silent',
  });
  return result.outputFiles.map((f) => f.text).join('\n');
}

describe('dev sign-in provider', () => {
  it('signs in by email outside production, creating the user once', async () => {
    const { auth } = makeAuth();
    const email = uniqueEmail('dev');
    const first = await devSignInAs(auth, email);
    const second = await devSignInAs(auth, email);
    expect(first.user.email).toBe(email);
    expect(second.user.id).toBe(first.user.id);
    expect(first.cookie).toContain('better-auth.session_token=');
  });

  it('returns 404 when imported with NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const helpers = await import('./helpers');
    const { auth } = helpers.makeAuth({ env: { NODE_ENV: 'production' } });
    const response = await helpers.authRequest(auth, '/dev/sign-in', {
      body: { email: uniqueEmail('prod') },
    });
    expect(response.status).toBe(404);
    expect(auth.options.plugins.map((p) => p.id)).not.toContain('dev-sign-in');
  });

  it('answers 404 itself if the process switches to production at request time', async () => {
    const { auth } = makeAuth();
    vi.stubEnv('NODE_ENV', 'production');
    const response = await authRequest(auth, '/dev/sign-in', {
      body: { email: uniqueEmail('late') },
    });
    expect(response.status).toBe(404);
  });

  it('is absent from the production bundle and present in the development one', async () => {
    const production = await bundleServer('production');
    const development = await bundleServer('development');
    for (const marker of ['dev-sign-in', '/dev/sign-in', 'createSession']) {
      expect(production, marker).not.toContain(marker);
    }
    expect(development).toContain('dev-sign-in');
    expect(development).toContain('/dev/sign-in');
  });
});
