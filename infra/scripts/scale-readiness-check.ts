// `pnpm scale-readiness`: verify the day-one rules that keep the move to several nodes a config
// change (#106). Runs with Node's type stripping, so it uses only erasable TypeScript syntax. The
// checkers are pure (text in, findings out); main() reads the repo and exits non-zero on any finding.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Finding {
  rule: string;
  detail: string;
}

/** Services that must stay stateless: they run on any node. */
export const STATELESS_SERVICES: readonly string[] = ['web', 'api', 'worker', 'admin'];

/** Marker that allows a destructive statement in one migration (the contract step). */
export const CONTRACT_MARKER = '-- contract:';

/** Top-level service blocks of a compose file (`  name:` under `services:`). */
export function parseComposeServices(text: string): Map<string, string> {
  const services = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  let inServices = false;
  let current: string | undefined;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      current = undefined;
      continue;
    }
    if (!inServices) continue;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header?.[1] !== undefined) {
      current = header[1];
      services.set(current, '');
    } else if (current !== undefined) {
      services.set(current, `${services.get(current) ?? ''}${line}\n`);
    }
  }
  return services;
}

/** Rule 1 and 2: stateless containers, state only in Postgres and S3 (no volumes on app services). */
export function checkStatelessServices(compose: string): Finding[] {
  const findings: Finding[] = [];
  const services = parseComposeServices(compose);
  for (const name of STATELESS_SERVICES) {
    const block = services.get(name);
    if (block === undefined) {
      findings.push({ rule: 'stateless', detail: `compose service '${name}' is missing` });
      continue;
    }
    if (!/^ {4}read_only:\s*true\s*$/m.test(block)) {
      findings.push({ rule: 'stateless', detail: `${name}: read_only: true is required` });
    }
    if (/^ {4}volumes:\s*$/m.test(block)) {
      findings.push({
        rule: 'stateless',
        detail: `${name}: local volumes are not allowed (state lives in Postgres and S3)`,
      });
    }
    if (!/^ {4}env_file:/m.test(block)) {
      findings.push({
        rule: 'env-config',
        detail: `${name}: configuration must come from env_file`,
      });
    }
  }
  return findings;
}

/** Rule 4: liveness and readiness routes exist. */
export function checkHealthRoutes(files: {
  healthz?: string | undefined;
  readyz?: string | undefined;
}): Finding[] {
  const findings: Finding[] = [];
  if (
    !files.healthz ||
    !/export\s+(async\s+)?function\s+GET|export\s+const\s+GET/.test(files.healthz)
  ) {
    findings.push({ rule: 'health', detail: '/healthz route with a GET handler is missing' });
  }
  if (
    !files.readyz ||
    !/export\s+(async\s+)?function\s+GET|export\s+const\s+GET/.test(files.readyz)
  ) {
    findings.push({ rule: 'health', detail: '/readyz route with a GET handler is missing' });
  }
  return findings;
}

const ENDPOINT_LITERAL =
  /['"`]https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|minio|postgres)[:/'"`]|['"`]https?:\/\/[a-z0-9.-]*\.amazonaws\.com/;

/** Rule 3: env-only config. Source files must not hardcode service endpoints. */
export function checkEnvOnlyConfig(sources: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (ENDPOINT_LITERAL.test(line)) {
        findings.push({
          rule: 'env-config',
          detail: `${file}:${String(index + 1)} hardcodes a service endpoint; read it from env`,
        });
      }
    });
  }
  return findings;
}

/** Rule 5: the worker keeps idempotency tests. */
export function checkIdempotencyTests(testFiles: Record<string, string>): Finding[] {
  const hasTest = Object.values(testFiles).some(
    (text) => /idempoten/i.test(text) && /\b(it|test)\(/.test(text),
  );
  return hasTest
    ? []
    : [{ rule: 'idempotent-jobs', detail: 'no worker test mentions idempotency' }];
}

/** Rule 6: expand/migrate/contract. A destructive statement needs the contract marker. */
export function checkMigrations(migrations: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  const destructive =
    /\bdrop\s+(table|column)\b|\brename\s+(to|column)\b|\balter\s+table\s+\S+\s+rename\b/i;
  for (const [file, sql] of Object.entries(migrations)) {
    if (sql.includes(CONTRACT_MARKER)) continue;
    const code = sql.replace(/--[^\n]*/g, '');
    const match = destructive.exec(code);
    if (match) {
      findings.push({
        rule: 'migrations',
        detail: `${file}: '${match[0]}' needs a '${CONTRACT_MARKER} <reason>' marker (expand first, contract in a later release)`,
      });
    }
  }
  return findings;
}

function readTree(
  root: string,
  dir: string,
  match: (file: string) => boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (match(full)) out[path.relative(root, full)] = readFileSync(full, 'utf8');
    }
  };
  walk(path.join(root, dir));
  return out;
}

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

const isSource = (file: string): boolean =>
  /\.(ts|tsx)$/.test(file) && !/(__tests__|\.test\.|\.spec\.|fixtures|\.d\.ts)/.test(file);

export function runChecks(root: string): Finding[] {
  const compose = readIfExists(path.join(root, 'infra/docker/compose.prod.yml')) ?? '';
  const sources: Record<string, string> = {};
  for (const dir of [
    'apps/web/app',
    'apps/web/lib',
    'apps/api/src',
    'apps/worker/src',
    'packages/storage/src',
  ]) {
    Object.assign(sources, readTree(root, dir, isSource));
  }
  return [
    ...checkStatelessServices(compose),
    ...checkHealthRoutes({
      healthz: readIfExists(path.join(root, 'apps/web/app/healthz/route.ts')),
      readyz: readIfExists(path.join(root, 'apps/web/app/readyz/route.ts')),
    }),
    ...checkEnvOnlyConfig(sources),
    ...checkIdempotencyTests(
      readTree(root, 'apps/worker/src/__tests__', (file) => file.endsWith('.test.ts')),
    ),
    ...checkMigrations(readTree(root, 'packages/db/migrations', (file) => file.endsWith('.sql'))),
  ];
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const findings = runChecks(root);
  for (const finding of findings) console.error(`✗ [${finding.rule}] ${finding.detail}`);
  if (findings.length > 0) {
    console.error(`\nscale-readiness: ${String(findings.length)} finding(s).`);
    process.exit(1);
  }
  console.log('scale-readiness: all day-one rules hold.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
