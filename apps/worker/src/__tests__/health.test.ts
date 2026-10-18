// /healthz and /readyz on the worker port; readyz fails when the DB is unreachable (#15).
import type { Server } from 'node:http';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

import { testDatabaseUrls } from '@causedeck/db/testing';

import { afterEach, describe, expect, it } from 'vitest';

import { closeServer, startHealthServer, workerChecks } from '../health.ts';
import { createWorker } from '../worker.ts';

import { captureLogger, startTestWorker, stopTestWorkers } from './helpers.ts';

const servers: Server[] = [];

async function serve(checks: Parameters<typeof startHealthServer>[0]['checks']) {
  const server = await startHealthServer({ port: 0, host: '127.0.0.1', checks, timeoutMs: 1500 });
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return (path: string) => fetch(`http://127.0.0.1:${String(port)}${path}`);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await stopTestWorkers();
});

describe('worker health server', () => {
  it('serves /healthz and a passing /readyz with a running worker', async () => {
    const worker = await startTestWorker([]);
    const get = await serve(workerChecks(worker));

    const health = await get('/healthz');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });

    const ready = await get('/readyz');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: 'ok',
      checks: { db: { ok: true }, handlers: { ok: true } },
    });
    expect((await get('/nope')).status).toBe(404);
  });

  it('fails /readyz when the database becomes unreachable, while /healthz stays up', async () => {
    // Route the worker through a TCP proxy to the test database, then cut it.
    const target = new URL(testDatabaseUrls().owner);
    const sockets = new Set<Socket>();
    const proxy = createServer((client) => {
      const upstream = connect(Number(target.port), target.hostname);
      sockets.add(client).add(upstream);
      client.pipe(upstream).pipe(client);
      const drop = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', drop);
      upstream.on('error', drop);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxied = new URL(target);
    proxied.host = `127.0.0.1:${String((proxy.address() as AddressInfo).port)}`;
    const worker = createWorker({
      connectionString: proxied.toString(),
      db: undefined as never,
      logger: captureLogger().logger,
      registry: { definitions: [] },
    });
    await worker.start();
    const get = await serve(workerChecks(worker));
    expect((await get('/readyz')).status).toBe(200);

    await new Promise<void>((resolve) => {
      proxy.close(() => {
        resolve();
      });
      for (const socket of sockets) socket.destroy();
    });

    const ready = await get('/readyz');
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      status: 'error',
      checks: { db: { ok: false }, handlers: { ok: true } },
    });
    expect((await get('/healthz')).status).toBe(200);
    await worker.boss.stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
  });

  it('fails /readyz until handlers are registered', async () => {
    const worker = await startTestWorker([]);
    await worker.stop(1000);
    const get = await serve(workerChecks(worker));

    const ready = await get('/readyz');
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ checks: { handlers: { ok: false } } });
  });
});
