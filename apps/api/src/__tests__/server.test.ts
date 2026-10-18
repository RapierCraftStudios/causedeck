// Graceful shutdown: on SIGTERM the server stops accepting connections, lets in-flight requests
// finish (up to the timeout, 10 s by default), then exits 0.
import { request as httpRequest } from 'node:http';

import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { drainServer, handleShutdownSignals, SHUTDOWN_TIMEOUT_MS, startServer } from '../server.ts';

function slowApp(delayMs: number) {
  const app = new Hono();
  app.get('/slow', async (c) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return c.text('done');
  });
  app.get('/fast', (c) => c.text('fast'));
  return app;
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

const quiet = { info: vi.fn(), error: vi.fn() };
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('graceful shutdown', () => {
  it('drains for up to 10 s by default', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(10_000);
  });

  it('on SIGTERM finishes in-flight requests, refuses new ones, then exits 0', async () => {
    const { server, port } = await startServer({
      app: slowApp(300),
      port: 0,
      hostname: '127.0.0.1',
    });
    const exit = vi.fn();
    const cleanup = vi.fn(() => Promise.resolve());
    cleanups.push(
      handleShutdownSignals(server, { logger: quiet, cleanup, exit, signals: ['SIGUSR2'] }),
    );

    const inFlight = get(port, '/slow');
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.kill(process.pid, 'SIGUSR2');
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(get(port, '/fast')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    await expect(inFlight).resolves.toEqual({ status: 200, body: 'done' });

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(quiet.info).toHaveBeenCalledWith({ outcome: 'drained' }, 'server closed');
  });

  it('cuts off requests still running at the deadline and still exits 0', async () => {
    const { server, port } = await startServer({
      app: slowApp(5_000),
      port: 0,
      hostname: '127.0.0.1',
    });
    const exit = vi.fn();
    cleanups.push(
      handleShutdownSignals(server, { logger: quiet, exit, timeoutMs: 200, signals: ['SIGUSR2'] }),
    );

    const stuck = get(port, '/slow').catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    process.kill(process.pid, 'SIGUSR2');

    await vi.waitFor(
      () => {
        expect(exit).toHaveBeenCalledWith(0);
      },
      { timeout: 2_000 },
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await stuck).toMatchObject({ code: 'ECONNRESET' });
    expect(quiet.info).toHaveBeenCalledWith({ outcome: 'timeout' }, 'server closed');
  });

  it('drainServer resolves "drained" at once when idle', async () => {
    const { server } = await startServer({ app: slowApp(0), port: 0, hostname: '127.0.0.1' });
    await expect(drainServer(server, 1_000)).resolves.toBe('drained');
  });
});
