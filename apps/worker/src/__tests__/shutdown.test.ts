// Graceful shutdown: SIGTERM mid-job lets the job finish (up to the timeout) and requeues work
// that is still running when the timeout expires (#15).
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { testDatabaseUrls } from '@causedeck/db/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { startTestWorker, stopTestWorkers, uniqueName, waitFor } from './helpers.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/shutdown-worker.ts', import.meta.url));

interface Child {
  proc: ChildProcess;
  lines: string[];
  exited: Promise<number | null>;
}

const children: ChildProcess[] = [];

function spawnWorker(env: Record<string, string>): Child {
  const urls = testDatabaseUrls();
  const proc = spawn(process.execPath, ['--import', 'tsx', FIXTURE], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      // eslint-disable-next-line no-process-env -- the child inherits PATH and friends.
      ...process.env,
      NODE_ENV: 'test',
      OWNER_URL: urls.owner,
      APP_URL: urls.app,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(proc);
  const lines: string[] = [];
  let buffer = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    lines.push(...parts);
  });
  const exited = new Promise<number | null>((resolve) => {
    proc.on('exit', (code) => {
      resolve(code);
    });
  });
  return { proc, lines, exited };
}

afterEach(async () => {
  for (const proc of children.splice(0)) proc.kill('SIGKILL');
  await stopTestWorkers();
});

describe('graceful shutdown on SIGTERM', () => {
  it('lets an in-flight job finish, then exits 0', async () => {
    const queue = uniqueName('slow');
    const child = spawnWorker({ QUEUE: queue, JOB_MS: '3000', STOP_TIMEOUT_MS: '30000' });
    await waitFor(() => child.lines.includes('ready'), { timeoutMs: 60_000 });
    const producer = await startTestWorker([]);
    const id = await producer.boss.send(queue, { workspaceId: randomUUID() });
    await waitFor(() => child.lines.some((l) => l.startsWith(`started ${id ?? ''}`)));

    child.proc.kill('SIGTERM');

    expect(await child.exited).toBe(0);
    expect(child.lines).toContain(`finished ${id ?? ''}`);
    expect(child.lines.at(-1)).toBe('stopped');
    const [job] = await producer.boss.findJobs(queue, { id: id ?? '' });
    expect(job?.state).toBe('completed');
  });

  it('requeues a job still running when the shutdown timeout expires', async () => {
    const queue = uniqueName('stuck');
    const child = spawnWorker({ QUEUE: queue, JOB_MS: '20000', STOP_TIMEOUT_MS: '1500' });
    await waitFor(() => child.lines.includes('ready'), { timeoutMs: 60_000 });
    const producer = await startTestWorker([]);
    const id = await producer.boss.send(queue, { workspaceId: randomUUID() });
    await waitFor(() => child.lines.some((l) => l.startsWith(`started ${id ?? ''}`)));
    const signalled = Date.now();

    child.proc.kill('SIGTERM');

    expect(await child.exited).toBe(0);
    expect(Date.now() - signalled).toBeLessThan(15_000);
    expect(child.lines).not.toContain(`finished ${id ?? ''}`);
    const [job] = await producer.boss.findJobs(queue, { id: id ?? '' });
    expect(job?.state).toBe('retry');

    // A fresh worker picks the interrupted job up again.
    const next = spawnWorker({ QUEUE: queue, JOB_MS: '100', STOP_TIMEOUT_MS: '30000' });
    await waitFor(() => next.lines.includes(`finished ${id ?? ''}`), { timeoutMs: 60_000 });
    expect(next.lines).toContain(`started ${id ?? ''} attempt 2`);
  });
});
