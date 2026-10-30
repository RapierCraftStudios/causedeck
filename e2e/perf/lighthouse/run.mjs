// Lighthouse CI for the perf run (#105): signs the seeded demo advocate in through the real
// magic-link flow (Mailpit), then runs lhci with the session cookie so today, brief sheet and
// obligations are audited instead of the sign-in redirect. `mobile` (default) or `android`
// (4x CPU slowdown, slow 4G: ANDROID_PROFILE_FLAGS). Run with --experimental-strip-types.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertAllowedTarget } from '../guard.ts';
import { ANDROID_PROFILE_FLAGS } from '../thresholds.ts';

/* eslint-disable no-process-env -- a CI runner script: harness knobs from the environment. */
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const ORIGIN = process.env.PERF_BASE_URL ?? 'http://localhost:3100';
const env = process.env;
/* eslint-enable no-process-env */
const EMAIL = 'advocate.chennai-solo@demo.causedeck.test';
const CALLBACK = '/w/demo-chennai-solo/today';
const profile = process.argv[2] ?? 'mobile';
if (profile !== 'mobile' && profile !== 'android') throw new Error(`unknown profile ${profile}`);
assertAllowedTarget(ORIGIN, env);

const perfDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const e2eDir = path.join(perfDir, '..');

async function mailpit(pathAndQuery) {
  const response = await fetch(`${MAILPIT_URL}${pathAndQuery}`);
  if (!response.ok) throw new Error(`Mailpit ${pathAndQuery}: ${String(response.status)}`);
  return response.json();
}

async function readMagicLink(since) {
  const pattern = new RegExp(`${ORIGIN}/api/auth/magic-link/verify\\S*`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { messages } = await mailpit(
      `/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL}"`)}&limit=20`,
    );
    for (const summary of messages.filter((m) => Date.parse(m.Created) >= since)) {
      const { Text } = await mailpit(`/api/v1/message/${summary.ID}`);
      const match = pattern.exec(Text);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no magic link for ${EMAIL} in Mailpit`);
}

async function signIn() {
  const since = Date.now() - 1000;
  const request = await fetch(`${ORIGIN}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, callbackURL: CALLBACK }),
  });
  if (!request.ok) throw new Error(`magic-link request failed: ${String(request.status)}`);
  const verify = await fetch(await readMagicLink(since), {
    redirect: 'manual',
    headers: { origin: ORIGIN },
  });
  const cookies = verify.headers.getSetCookie().map((h) => h.split(';')[0] ?? '');
  if (!cookies.some((pair) => pair.split('=')[0]?.endsWith('better-auth.session_token')))
    throw new Error(`verifying the magic link set no session (${String(verify.status)})`);
  return cookies.join('; ');
}

const cookie = await signIn();
const args = [
  'autorun',
  `--config=${path.join('perf', 'lighthouse', 'lighthouserc.json')}`,
  `--collect.settings.extraHeaders=${JSON.stringify({ Cookie: cookie })}`,
  ...(profile === 'android' ? ANDROID_PROFILE_FLAGS : []),
];
const result = spawnSync(path.join(e2eDir, 'node_modules', '.bin', 'lhci'), args, {
  cwd: e2eDir,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
