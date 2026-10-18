// Unit tests for `pnpm run doctor`:
//   node --experimental-strip-types --no-warnings --test infra/scripts/doctor.test.ts
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';

import { checkDocker, checkNode, checkPnpm, checkPort, isPortFree, parseMajor } from './doctor.ts';

function listen(): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function portOf(server: net.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

describe('doctor', () => {
  it('parses major versions', () => {
    assert.equal(parseMajor('v22.11.0'), 22);
    assert.equal(parseMajor('10.34.7\n'), 10);
    assert.equal(parseMajor('garbage'), undefined);
    assert.equal(parseMajor(undefined), undefined);
  });

  it('accepts Node 22 only and explains how to fix other versions', () => {
    assert.equal(checkNode('v22.11.0').ok, true);
    for (const version of ['v20.18.0', 'v24.1.0', '']) {
      const result = checkNode(version);
      assert.equal(result.ok, false);
      assert.match(result.fix ?? '', /Node 22/);
    }
  });

  it('accepts pnpm 10 only and explains how to install it', () => {
    assert.equal(checkPnpm('10.34.7').ok, true);
    const wrong = checkPnpm('9.15.0');
    assert.equal(wrong.ok, false);
    assert.match(wrong.fix ?? '', /pnpm 10/);
    const missing = checkPnpm(undefined);
    assert.equal(missing.ok, false);
    assert.match(missing.fix ?? '', /corepack enable/);
  });

  it('reports a missing CLI and an unreachable daemon differently', () => {
    assert.equal(checkDocker(0).ok, true);
    assert.equal(checkDocker(1).detail, 'daemon not reachable');
    assert.equal(checkDocker(null).detail, 'docker CLI not found');
    assert.match(checkDocker(1).fix ?? '', /docker info/);
  });

  it('flags a port that is already in use and passes a free one', async () => {
    const server = await listen();
    const port = portOf(server);
    try {
      assert.equal(await isPortFree(port), false);
      const busy = await checkPort(port, 'Test');
      assert.equal(busy.ok, false);
      assert.match(busy.fix ?? '', new RegExp(`lsof -i :${String(port)}`));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    assert.equal((await checkPort(port, 'Test')).ok, true);
  });
});
