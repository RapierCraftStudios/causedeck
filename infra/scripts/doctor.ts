// `pnpm run doctor`: check the prerequisites for the local dev stack and print a fix for each problem.
// Runs with Node's type stripping (no build step), so it uses only erasable TypeScript syntax.
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

/** Host ports published by infra/docker/compose.dev.yml. */
export const STACK_PORTS: readonly { port: number; service: string }[] = [
  { port: 5432, service: 'Postgres' },
  { port: 9000, service: 'MinIO API' },
  { port: 9001, service: 'MinIO console' },
  { port: 1025, service: 'Mailpit SMTP' },
  { port: 8025, service: 'Mailpit UI' },
];

/** Major version from strings such as `v22.11.0` or `10.4.1`; undefined when unparsable. */
export function parseMajor(version: string | undefined): number | undefined {
  const match = /^v?(\d+)\./.exec(version?.trim() ?? '');
  return match ? Number(match[1]) : undefined;
}

export function checkNode(version: string): CheckResult {
  const major = parseMajor(version);
  if (major === 22) return { name: 'Node 22', ok: true, detail: version };
  return {
    name: 'Node 22',
    ok: false,
    detail: `found ${version || 'unknown version'}`,
    fix: 'Install Node 22 (the repo pins it in .nvmrc): `nvm install && nvm use` or `fnm use`.',
  };
}

export function checkPnpm(version: string | undefined): CheckResult {
  if (version === undefined) {
    return {
      name: 'pnpm 10',
      ok: false,
      detail: 'pnpm not found',
      fix: 'Enable pnpm with `corepack enable` (the version comes from package.json packageManager).',
    };
  }
  const major = parseMajor(version);
  if (major === 10) return { name: 'pnpm 10', ok: true, detail: version };
  return {
    name: 'pnpm 10',
    ok: false,
    detail: `found ${version}`,
    fix: 'Use pnpm 10: `corepack enable && corepack prepare --activate` in the repo root.',
  };
}

export function checkDocker(dockerInfoStatus: number | null): CheckResult {
  if (dockerInfoStatus === 0) return { name: 'Docker daemon', ok: true, detail: 'reachable' };
  return {
    name: 'Docker daemon',
    ok: false,
    detail: dockerInfoStatus === null ? 'docker CLI not found' : 'daemon not reachable',
    fix:
      'Install Docker with Compose v2 and start the daemon (Docker Desktop, OrbStack or ' +
      '`sudo systemctl start docker`), then check that `docker info` works.',
  };
}

/** Resolves true when nothing listens on 127.0.0.1:<port>. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

export async function checkPort(port: number, service: string): Promise<CheckResult> {
  const name = `Port ${String(port)} (${service})`;
  if (await isPortFree(port)) return { name, ok: true, detail: 'free' };
  return {
    name,
    ok: false,
    detail: 'in use',
    fix:
      `Free port ${String(port)}: \`lsof -i :${String(port)}\` shows the process. If it is this ` +
      'stack already running, `pnpm stack:down` stops it.',
  };
}

function commandOutput(command: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error) return { status: null, stdout: '' };
  return { status: result.status, stdout: result.stdout.trim() };
}

export async function runChecks(): Promise<CheckResult[]> {
  const pnpm = commandOutput('pnpm', ['--version']);
  const docker = commandOutput('docker', ['info']);
  return [
    checkNode(process.version),
    checkPnpm(pnpm.status === 0 ? pnpm.stdout : undefined),
    checkDocker(docker.status),
    ...(await Promise.all(STACK_PORTS.map(({ port, service }) => checkPort(port, service)))),
  ];
}

async function main(): Promise<void> {
  const results = await runChecks();
  for (const result of results) {
    console.log(`${result.ok ? '✓' : '✗'} ${result.name}: ${result.detail}`);
    if (result.fix) console.log(`    fix: ${result.fix}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  if (failed > 0) {
    console.error(`\ndoctor: ${String(failed)} check(s) failed.`);
    process.exit(1);
  }
  console.log('\ndoctor: all prerequisites are in place. Run `pnpm dev`.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
