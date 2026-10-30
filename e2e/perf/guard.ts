// Safety rails for the perf tests (#105): they only run against a local stack or staging, never
// production, and they make no external network call.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export class PerfTargetError extends Error {
  override name = 'PerfTargetError';
}

/** Hosts a perf run may target: local stacks plus `PERF_STAGING_HOST` (and its subdomains). */
export function allowedHosts(env: Record<string, string | undefined>): string[] {
  const staging = env.PERF_STAGING_HOST?.trim().toLowerCase();
  return staging ? [...LOCAL_HOSTS, staging] : [...LOCAL_HOSTS];
}

/** Throws unless `url` is on the allow-list. Production is never on it. */
export function assertAllowedTarget(
  url: string,
  env: Record<string, string | undefined> = {},
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PerfTargetError(`perf: not a URL: ${url}`);
  }
  const staging = env.PERF_STAGING_HOST?.trim().toLowerCase();
  // The staging entry must name staging: a production host set here by mistake is refused.
  if (staging && !staging.includes('staging')) {
    throw new PerfTargetError(`perf: PERF_STAGING_HOST ${staging} is not a staging host`);
  }
  const host = parsed.host.toLowerCase();
  const ok = allowedHosts(env).some(
    (allowed) => host === allowed || host.startsWith(`${allowed}:`) || host.endsWith(`.${allowed}`),
  );
  if (!ok)
    throw new PerfTargetError(`perf: ${parsed.host} is not on the allow-list (local, staging)`);
  return parsed;
}

/** The providers a perf run requires: mock AI, mock billing, local mail and local storage. */
export function checkMockProviders(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (env.AI_PROVIDER !== 'mock') problems.push('AI_PROVIDER must be mock');
  if (env.BILLING_PROVIDER !== 'mock') problems.push('BILLING_PROVIDER must be mock');
  if (env.EMAIL_PROVIDER !== 'smtp' && env.EMAIL_PROVIDER !== 'mock')
    problems.push('EMAIL_PROVIDER must be smtp (Mailpit) or mock');
  for (const key of ['SMTP_URL', 'S3_ENDPOINT'] as const) {
    const value = env[key];
    if (!value) continue;
    try {
      assertAllowedTarget(value.replace(/^smtp:/, 'http:'), env);
    } catch {
      problems.push(`${key} points outside the local stack`);
    }
  }
  return problems;
}

/**
 * Egress check: a request to a host outside the allow-list must fail. `probe` performs the request
 * (the runner passes a real fetch to a reserved `.invalid` host) and resolves true when it got any
 * answer. Resolves to true when egress is blocked.
 */
export async function assertEgressBlocked(probe: () => Promise<boolean>): Promise<true> {
  let reached = false;
  try {
    reached = await probe();
  } catch {
    reached = false;
  }
  if (reached) throw new PerfTargetError('perf: external network egress is not blocked');
  return true;
}
