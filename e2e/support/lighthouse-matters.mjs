// Entry point of `lhci:matters` (#394): Lighthouse CI on the signed-in, seeded matters list and
// overview (`lighthouserc.matters.json`), the same way `lhci:courts` audits the courts pages
// (support/lighthouse-courts.mjs): a production build of apps/web, a database migrated and seeded
// with the `e2e` profile, `EMAIL_PROVIDER=smtp` pointed at Mailpit, and the seeded owner signed in
// through the real magic-link flow. That profile has no matters, so this first inserts the matters
// fixtures (fixtures/matters-data.ts) as the owner role (`DATABASE_URL_OWNER`). Run it with
// `--experimental-strip-types` (the package script does) so it can load that TypeScript module.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { matterForumId, seedMatterFixtures } from '../fixtures/matters-data.ts';
import { COURTS_WORKSPACE_ID } from '../fixtures/courts-data.ts';

/* eslint-disable no-process-env -- a CI runner script: Mailpit's URL is a test-harness knob. */
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025';
/* eslint-enable no-process-env */
const PORT = 3100;
const ORIGIN = `http://localhost:${String(PORT)}`;
const EMAIL = 'owner@chennai-solo.e2e.test';
const CALLBACK = '/w/chennai-solo/matters';

const e2eDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(e2eDir, '..', 'apps', 'web');

/** `next start` from apps/web; resolves once it prints `Ready`. */
function startServer() {
  const server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)],
    { cwd: webDir, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('lhci:matters: next start was not ready within 60 s'));
    }, 60_000);
    server.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      if (String(chunk).includes('Ready')) {
        clearTimeout(timer);
        resolve(undefined);
      }
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`lhci:matters: next start exited with ${String(code)}`));
    });
  });
  return { server, ready };
}

async function mailpit(pathAndQuery) {
  const response = await fetch(`${MAILPIT_URL}${pathAndQuery}`);
  if (!response.ok)
    throw new Error(`lhci:matters: Mailpit ${pathAndQuery}: ${String(response.status)}`);
  return response.json();
}

/** The newest magic link Mailpit holds for `email` sent after `since`. */
async function readMagicLink(email, since) {
  const pattern = new RegExp(`${ORIGIN}/api/auth/magic-link/verify\\S*`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { messages } = await mailpit(
      `/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`,
    );
    for (const summary of messages.filter((m) => Date.parse(m.Created) >= since)) {
      const { Text } = await mailpit(`/api/v1/message/${summary.ID}`);
      const match = pattern.exec(Text);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`lhci:matters: no magic link for ${email} in Mailpit (${MAILPIT_URL})`);
}

/** Sign the seeded owner in; returns the `Cookie` header value carrying the session. */
async function signIn() {
  const since = Date.now() - 1000;
  const request = await fetch(`${ORIGIN}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, callbackURL: CALLBACK }),
  });
  if (!request.ok) {
    throw new Error(`lhci:matters: magic-link request failed: ${String(request.status)}`);
  }
  const link = await readMagicLink(EMAIL, since);
  const verify = await fetch(link, { redirect: 'manual', headers: { origin: ORIGIN } });
  const cookies = verify.headers.getSetCookie().map((header) => header.split(';')[0] ?? '');
  if (!cookies.some((pair) => pair.split('=')[0]?.endsWith('better-auth.session_token'))) {
    throw new Error(
      `lhci:matters: verifying the magic link set no session (${String(verify.status)})`,
    );
  }
  return cookies.join('; ');
}

/** Insert the matters fixtures into the migrated, e2e-seeded database (owner role, one workspace). */
async function seedMatters() {
  // eslint-disable-next-line no-process-env -- a CI runner script: the owner role's URL is set by the job.
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error('lhci:matters: DATABASE_URL_OWNER is not set');
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const forum = await matterForumId(sql);
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${COURTS_WORKSPACE_ID}, true)`;
      await seedMatterFixtures(tx, forum);
    });
  } finally {
    await sql.end();
  }
}

await seedMatters();
const { server, ready } = startServer();
let status = 1;
try {
  await ready;
  const cookie = await signIn();
  const lhci = path.join(e2eDir, 'node_modules', '.bin', 'lhci');
  const result = spawnSync(
    lhci,
    [
      'autorun',
      '--config=lighthouserc.matters.json',
      `--collect.settings.extraHeaders=${JSON.stringify({ Cookie: cookie })}`,
    ],
    { cwd: e2eDir, stdio: 'inherit' },
  );
  status = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  server.removeAllListeners('exit');
  server.kill();
}
process.exit(status);
