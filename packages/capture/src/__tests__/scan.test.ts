// Scan providers (#43): the EICAR test double, the no-op scanner, the scan decision and the clamd
// INSTREAM client against a small fake clamd on a local TCP port.
import net from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ClamAvScanner,
  createScanProvider,
  decideScan,
  EICAR_SIGNATURE,
  EICAR_TEST_STRING,
  MockEicarScanner,
  NoopScanner,
  parseClamdReply,
} from '../index.ts';

async function* chunks(...parts: (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield typeof part === 'string' ? Buffer.from(part, 'latin1') : part;
  await Promise.resolve();
}

describe('EICAR test double and no-op scanner', () => {
  it('flags the EICAR test string, even split across chunks', async () => {
    const scanner = new MockEicarScanner();
    expect(await scanner.scan(chunks(EICAR_TEST_STRING))).toEqual({
      outcome: 'infected',
      signature: EICAR_SIGNATURE,
    });
    const half = Math.floor(EICAR_TEST_STRING.length / 2);
    expect(
      (
        await scanner.scan(
          chunks('%PDF-1.7 ', EICAR_TEST_STRING.slice(0, half), EICAR_TEST_STRING.slice(half)),
        )
      ).outcome,
    ).toBe('infected');
  });

  it('passes clean bytes', async () => {
    expect(await new MockEicarScanner().scan(chunks('%PDF-1.7\n%%EOF\n'))).toEqual({
      outcome: 'clean',
    });
  });

  it('the no-op scanner skips', async () => {
    expect(await new NoopScanner().scan()).toEqual({ outcome: 'skipped' });
  });

  it('picks ClamAV only when a host is configured', () => {
    expect(createScanProvider({ required: false, clamav: null }).name).toBe('noop');
    const clam = { host: '127.0.0.1', port: 3310, timeoutMs: 1000, maxBytes: 1024 };
    expect(createScanProvider({ required: true, clamav: clam }).name).toBe('clamav');
  });
});

describe('decideScan', () => {
  it('maps outcomes to a scan status or a failure', () => {
    expect(decideScan('clean', false)).toEqual({ ok: true, scanStatus: 'clean' });
    expect(decideScan('clean', true)).toEqual({ ok: true, scanStatus: 'clean' });
    expect(decideScan('infected', false)).toEqual({
      ok: false,
      quarantine: true,
      scanStatus: 'infected',
    });
    expect(decideScan('error', false)).toEqual({
      ok: false,
      quarantine: false,
      reason: 'scan_unavailable',
    });
  });

  it('CAPTURE_SCAN_REQUIRED makes a skipped scan a failure (Stage B)', () => {
    expect(decideScan('skipped', false)).toEqual({ ok: true, scanStatus: 'skipped' });
    expect(decideScan('skipped', true)).toEqual({
      ok: false,
      quarantine: false,
      reason: 'scan_required',
    });
  });
});

describe('parseClamdReply', () => {
  it('reads OK, FOUND and everything else', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ outcome: 'clean' });
    expect(parseClamdReply('stream: Eicar-Test-Signature FOUND\0')).toEqual({
      outcome: 'infected',
      signature: 'Eicar-Test-Signature',
    });
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR\0').outcome).toBe('error');
    expect(parseClamdReply('').outcome).toBe('error');
  });
});

/** A fake clamd: reads zINSTREAM frames, answers FOUND when the stream holds the EICAR string. */
function fakeClamd(
  options: { silent?: boolean } = {},
): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let started = false;
    const body: Buffer[] = [];
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (!started) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        expect(buffer.subarray(0, end).toString('latin1')).toBe('zINSTREAM');
        buffer = buffer.subarray(end + 1);
        started = true;
      }
      for (;;) {
        if (buffer.length < 4) return;
        const size = buffer.readUInt32BE(0);
        if (size === 0) {
          if (options.silent) return;
          const found = Buffer.concat(body).includes(Buffer.from(EICAR_TEST_STRING, 'latin1'));
          socket.end(found ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buffer.length < 4 + size) return;
        body.push(buffer.subarray(4, 4 + size));
        buffer = buffer.subarray(4 + size);
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as net.AddressInfo).port });
    });
  });
}

describe('ClamAvScanner', () => {
  const servers: net.Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function scanner(
    overrides: Partial<ConstructorParameters<typeof ClamAvScanner>[0]> = {},
    silent = false,
  ) {
    const { server, port } = await fakeClamd({ silent });
    servers.push(server);
    return new ClamAvScanner({
      host: '127.0.0.1',
      port,
      timeoutMs: 2000,
      maxBytes: 1024 * 1024,
      ...overrides,
    });
  }

  it('reports clean bytes as clean', async () => {
    const result = await (await scanner()).scan(chunks('%PDF-1.7\n', Buffer.alloc(70_000, 1)));
    expect(result).toEqual({ outcome: 'clean' });
  });

  it('reports the EICAR string as infected with its signature', async () => {
    const result = await (await scanner()).scan(chunks('prefix ', EICAR_TEST_STRING));
    expect(result).toEqual({ outcome: 'infected', signature: 'Eicar-Test-Signature' });
  });

  it('errors past the size limit instead of sending', async () => {
    const result = await (await scanner({ maxBytes: 10 })).scan(chunks('0123456789ABCDEF'));
    expect(result).toMatchObject({ outcome: 'error', reason: 'too_large_to_scan' });
  });

  it('errors when clamd does not answer in time', async () => {
    const result = await (await scanner({ timeoutMs: 100 }, true)).scan(chunks('x'));
    expect(result).toMatchObject({ outcome: 'error', reason: 'scanner_unavailable' });
  });

  it('errors when clamd is unreachable', async () => {
    const { server, port } = await fakeClamd();
    await new Promise((resolve) => server.close(resolve));
    const result = await new ClamAvScanner({
      host: '127.0.0.1',
      port,
      timeoutMs: 500,
      maxBytes: 1024,
    }).scan(chunks('x'));
    expect(result).toMatchObject({ outcome: 'error' });
  });
});
