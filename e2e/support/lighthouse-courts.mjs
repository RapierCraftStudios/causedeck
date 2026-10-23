// Entry point of `lhci:courts` (#427): Lighthouse CI on the signed-in, seeded courts pages
// (`lighthouserc.courts.json`). Run it after a production build of apps/web, against a database
// migrated and seeded with the `e2e` profile, with `EMAIL_PROVIDER=smtp` pointed at Mailpit.
//
// A production build has no dev sign-in provider, so this signs the seeded owner in through the
// real magic-link flow: start `next start`, request a link, read it from the Mailpit API (as
// fixtures/auth.ts does), open it and keep the session cookie. Lighthouse then sends that cookie as
// a header on every request. The cookie and the link are never printed.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* eslint-disable no-process-env -- a CI runner script: Mailpit's URL is a test-harness knob. */
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025';
/* eslint-enable no-process-env */
const PORT = 3100;
const ORIGIN = `http://localhost:${String(PORT)}`;
const EMAIL = 'owner@chennai-solo.e2e.test';
const CALLBACK = '/w/chennai-solo/courts';

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
      reject(new Error('lhci:courts: next start was not ready within 60 s'));
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
      reject(new Error(`lhci:courts: next start exited with ${String(code)}`));
    });
  });
  return { server, ready };
}

async function mailpit(pathAndQuery) {
  const response = await fetch(`${MAILPIT_URL}${pathAndQuery}`);
  if (!response.ok)
    throw new Error(`lhci:courts: Mailpit ${pathAndQuery}: ${String(response.status)}`);
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
  throw new Error(`lhci:courts: no magic link for ${email} in Mailpit (${MAILPIT_URL})`);
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
    throw new Error(`lhci:courts: magic-link request failed: ${String(request.status)}`);
  }
  const link = await readMagicLink(EMAIL, since);
  const verify = await fetch(link, { redirect: 'manual', headers: { origin: ORIGIN } });
  const cookies = verify.headers.getSetCookie().map((header) => header.split(';')[0] ?? '');
  if (!cookies.some((pair) => pair.split('=')[0]?.endsWith('better-auth.session_token'))) {
    throw new Error(
      `lhci:courts: verifying the magic link set no session (${String(verify.status)})`,
    );
  }
  return cookies.join('; ');
}

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
      '--config=lighthouserc.courts.json',
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
