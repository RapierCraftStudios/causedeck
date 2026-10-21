// Envelope encryption format v1 (#216): round trips, bounded memory, tamper detection, key
// wrapping, field encryption and redaction. Pure: no database.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { Secret } from '@causedeck/config/env';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import {
  decryptField,
  decryptStream,
  encryptField,
  encryptStream,
  EnvKeyProvider,
  generateDek,
  isStorageCryptoError,
  KmsKeyProvider,
  parseHeader,
  StorageCryptoError,
  unwrapDek,
  wrapDek,
  type ByteSource,
} from '../index.ts';

const WS_A = randomUUID();
const WS_B = randomUUID();
const KEK_ID = 'kek-1';

async function collect(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

async function encrypt(
  plaintext: Buffer,
  {
    dek = DEK,
    workspaceId = WS_A,
    chunkSize,
  }: { dek?: Secret<Buffer>; workspaceId?: string; chunkSize?: number } = {},
): Promise<{ header: Buffer; chunks: Buffer[]; all: Buffer }> {
  const parts: Buffer[] = [];
  for await (const part of encryptStream([plaintext], {
    dek,
    workspaceId,
    kekId: KEK_ID,
    chunkSize,
  })) {
    parts.push(part);
  }
  const [header, ...chunks] = parts;
  if (header === undefined) throw new Error('no header');
  return { header, chunks, all: Buffer.concat(parts) };
}

function decrypt(
  source: ByteSource,
  { dek = DEK, workspaceId }: { dek?: Secret<Buffer>; workspaceId?: string } = {},
): Promise<Buffer> {
  return collect(decryptStream(source, { resolveDek: () => dek, workspaceId }));
}

async function failure(promise: Promise<unknown>): Promise<StorageCryptoError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StorageCryptoError) return error;
    throw error;
  }
  throw new Error('expected a StorageCryptoError');
}

const DEK = generateDek();

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof StorageCryptoError) return error.code;
    throw error;
  }
  return undefined;
}

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

describe('encryptStream / decryptStream round trip', () => {
  it.each([0, 1, 31, 32, 33, 64, 65, 1000])('%i bytes with 32-byte chunks', async (size) => {
    const plaintext = randomBytes(size);
    const { chunks, all } = await encrypt(plaintext, { chunkSize: 32 });
    expect(chunks).toHaveLength(Math.max(1, Math.ceil(size / 32)));
    expect(await decrypt([all])).toEqual(plaintext);
    // Any re-slicing of the ciphertext stream decrypts the same.
    const bytewise = [...all].map((b) => Buffer.from([b]));
    expect(await decrypt(bytewise)).toEqual(plaintext);
  });

  it.each([64 * 1024, 64 * 1024 + 1, 3 * 64 * 1024 - 7])(
    '%i bytes with default 64 KiB chunks',
    async (size) => {
      const plaintext = randomBytes(size);
      const { header, chunks, all } = await encrypt(plaintext);
      expect(parseHeader(header)?.chunkSize).toBe(64 * 1024);
      expect(chunks).toHaveLength(Math.ceil(size / (64 * 1024)));
      expect((await decrypt([all])).equals(plaintext)).toBe(true);
    },
  );

  it('writes the v1 header: magic, version, kek id, workspace, nonce, chunk size', async () => {
    const { header } = await encrypt(Buffer.from('x'));
    expect(header.subarray(0, 4).toString('ascii')).toBe('CDE1');
    expect(header[4]).toBe(1);
    const parsed = parseHeader(header);
    expect(parsed).toMatchObject({
      version: 1,
      kekId: KEK_ID,
      workspaceId: WS_A,
      chunkSize: 65536,
    });
    expect(parsed?.baseNonce).toHaveLength(12);
    expect(header).toHaveLength(4 + 1 + 1 + KEK_ID.length + 16 + 12 + 4);
  });

  it('round-trips a 120 MB stream in under 64 MB of memory', async () => {
    const total = 120 * 1024 * 1024;
    const piece = 1024 * 1024;
    const inHash = createHash('sha256');
    const outHash = createHash('sha256');
    // Live memory (heap plus Buffer backing stores) after a forced GC, so collectable garbage the
    // collector has not reached yet does not count; RSS alone would mostly measure GC timing.
    const live = () => {
      gc();
      const usage = process.memoryUsage();
      return usage.heapUsed + usage.arrayBuffers;
    };
    const baseline = live();
    let peak = 0;
    const sample = () => {
      peak = Math.max(peak, live() - baseline);
    };

    function* source(): Generator<Buffer> {
      for (let sent = 0; sent < total; sent += piece) {
        const bytes = randomBytes(piece);
        inHash.update(bytes);
        yield bytes;
        if ((sent / piece) % 8 === 0) sample();
      }
    }

    let received = 0;
    const encrypted = encryptStream(source(), { dek: DEK, workspaceId: WS_A, kekId: KEK_ID });
    for await (const part of decryptStream(encrypted, { resolveDek: () => DEK })) {
      outHash.update(part);
      received += part.length;
      if (received % (5 * 1024 * 1024) === 0) sample();
    }

    expect(received).toBe(total);
    expect(outHash.digest('hex')).toBe(inHash.digest('hex'));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(64 * 1024 * 1024);
  }, 120_000);
});

describe('tamper detection', () => {
  const plaintext = randomBytes(100);

  it('flipping any byte of the header fails', async () => {
    const { header, all } = await encrypt(plaintext, { chunkSize: 32 });
    for (let i = 0; i < header.length; i += 1) {
      const bad = Buffer.from(all);
      bad[i] = (bad[i] ?? 0) ^ 0x01;
      const error = await failure(decrypt([bad]));
      expect(['AUTH_FAILED', 'BAD_FORMAT'], `header byte ${String(i)}`).toContain(error.code);
    }
  });

  it('flipping any byte of the ciphertext or a tag fails authentication', async () => {
    const { header, all } = await encrypt(plaintext, { chunkSize: 32 });
    for (let i = header.length; i < all.length; i += 1) {
      const bad = Buffer.from(all);
      bad[i] = (bad[i] ?? 0) ^ 0x80;
      expect((await failure(decrypt([bad]))).code, `byte ${String(i)}`).toBe('AUTH_FAILED');
    }
  });

  it('flipping the bytes either side of a chunk boundary fails authentication', async () => {
    const { header, chunks, all } = await encrypt(plaintext, { chunkSize: 32 });
    const boundary = header.length + (chunks[0]?.length ?? 0);
    for (const i of [boundary - 1, boundary]) {
      const bad = Buffer.from(all);
      bad[i] = (bad[i] ?? 0) ^ 0xff;
      expect((await failure(decrypt([bad]))).code).toBe('AUTH_FAILED');
    }
  });

  it('swapping two chunks fails authentication', async () => {
    const { header, chunks } = await encrypt(plaintext, { chunkSize: 32 });
    const [c0, c1, ...rest] = chunks;
    if (c0 === undefined || c1 === undefined) throw new Error('need two chunks');
    expect((await failure(decrypt([header, c1, c0, ...rest]))).code).toBe('AUTH_FAILED');
  });

  it('dropping the final chunk, or appending a chunk, fails authentication', async () => {
    const { header, chunks } = await encrypt(plaintext, { chunkSize: 32 });
    expect((await failure(decrypt([header, ...chunks.slice(0, -1)]))).code).toBe('AUTH_FAILED');
    const extra = chunks[0];
    if (extra === undefined) throw new Error('no chunk');
    expect((await failure(decrypt([header, ...chunks, extra]))).code).toBe('AUTH_FAILED');
    expect((await failure(decrypt([header]))).code).toBe('AUTH_FAILED');
  });

  it('a chunk spliced in from another object with the same key fails', async () => {
    const one = await encrypt(plaintext, { chunkSize: 32 });
    const two = await encrypt(plaintext, { chunkSize: 32 });
    const [first, ...rest] = one.chunks;
    if (first === undefined || two.chunks[0] === undefined) throw new Error('no chunk');
    expect((await failure(decrypt([one.header, two.chunks[0], ...rest]))).code).toBe('AUTH_FAILED');
  });

  it("another workspace's DEK fails authentication", async () => {
    const { all } = await encrypt(plaintext);
    expect((await failure(decrypt([all], { dek: generateDek() }))).code).toBe('AUTH_FAILED');
  });

  it('an object of another workspace is rejected when the reader names its workspace', async () => {
    const { all } = await encrypt(plaintext, { workspaceId: WS_B });
    expect((await failure(decrypt([all], { workspaceId: WS_A }))).code).toBe('AUTH_FAILED');
  });

  it('rejects input that is not format v1', async () => {
    expect((await failure(decrypt([Buffer.from('%PDF-1.7 not encrypted')]))).code).toBe(
      'BAD_FORMAT',
    );
    expect((await failure(decrypt([Buffer.from('CD')]))).code).toBe('BAD_FORMAT');
  });
});

describe('DEK wrapping under the KEK', () => {
  const provider = new EnvKeyProvider([{ id: KEK_ID, key: new Secret(randomBytes(32)) }]);

  it('round-trips with AAD = workspace id', async () => {
    const dek = generateDek();
    const wrapped = await wrapDek(provider, KEK_ID, dek, WS_A);
    expect(wrapped).toHaveLength(60);
    expect((await unwrapDek(provider, KEK_ID, wrapped, WS_A)).reveal()).toEqual(dek.reveal());
  });

  it("fails for another workspace's id, a tampered wrap, an unknown or a different KEK", async () => {
    const wrapped = await wrapDek(provider, KEK_ID, generateDek(), WS_A);
    expect((await failure(unwrapDek(provider, KEK_ID, wrapped, WS_B))).code).toBe('AUTH_FAILED');
    const bad = Buffer.from(wrapped);
    bad[20] = (bad[20] ?? 0) ^ 1;
    expect((await failure(unwrapDek(provider, KEK_ID, bad, WS_A))).code).toBe('AUTH_FAILED');
    expect((await failure(unwrapDek(provider, 'kek-9', wrapped, WS_A))).code).toBe('UNKNOWN_KEK');
    const other = new EnvKeyProvider([{ id: KEK_ID, key: new Secret(randomBytes(32)) }]);
    expect((await failure(unwrapDek(other, KEK_ID, wrapped, WS_A))).code).toBe('AUTH_FAILED');
  });

  it('builds kek-1 from KEK_BASE64 and validates the rotation list', () => {
    const env = { KEK_BASE64: new Secret(randomBytes(32).toString('base64')) };
    const fromEnv = EnvKeyProvider.fromEnv(env, [
      { id: 'kek-0', key: new Secret(randomBytes(32)) },
    ]);
    expect(fromEnv.currentKekId()).toBe('kek-1');
    expect(fromEnv.has('kek-0')).toBe(true);
    expect(() => new EnvKeyProvider([])).toThrow(StorageCryptoError);
    expect(() => new EnvKeyProvider([{ id: 'k', key: new Secret(randomBytes(16)) }])).toThrow(
      StorageCryptoError,
    );
    const key = new Secret(randomBytes(32));
    expect(
      () =>
        new EnvKeyProvider([
          { id: 'k', key },
          { id: 'k', key },
        ]),
    ).toThrow(StorageCryptoError);
  });

  it('KmsKeyProvider is a Stage B stub', async () => {
    const kms = new KmsKeyProvider({ keyArn: 'arn:aws:kms:ap-south-1:000000000000:key/stub' });
    expect(() => kms.currentKekId()).toThrow(StorageCryptoError);
    const error = await failure(kms.wrap());
    expect(error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('field encryption', () => {
  it('round-trips and is bound to the DEK and the workspace', () => {
    const value = encryptField(DEK, WS_A, 'client prefers Tamil — सुनवाई 12/11');
    expect(value.startsWith('f1.')).toBe(true);
    expect(decryptField(DEK, WS_A, value)).toBe('client prefers Tamil — सुनवाई 12/11');
    expect(codeOf(() => decryptField(DEK, WS_B, value))).toBe('AUTH_FAILED');
    expect(codeOf(() => decryptField(generateDek(), WS_A, value))).toBe('AUTH_FAILED');
    const bytes = Buffer.from(value.slice(3), 'base64url');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(codeOf(() => decryptField(DEK, WS_A, `f1.${bytes.toString('base64url')}`))).toBe(
      'AUTH_FAILED',
    );
    expect(codeOf(() => decryptField(DEK, WS_A, 'plain text'))).toBe('BAD_FORMAT');
  });
});

describe('redaction: keys never reach logs or errors', () => {
  const kekBytes = randomBytes(32);
  const dek = generateDek();
  const provider = new EnvKeyProvider([{ id: KEK_ID, key: new Secret(kekBytes) }]);
  const forms = (bytes: Buffer) => [
    bytes.toString('hex'),
    bytes.toString('base64'),
    bytes.toString('base64url'),
  ];
  const leaks = (text: string) =>
    [...forms(kekBytes), ...forms(dek.reveal())].filter((form) => text.includes(form));

  it('String, JSON, inspect and pino show [REDACTED] for DEKs, KEKs and providers', () => {
    const lines: string[] = [];
    const logger = pino({}, { write: (line: string) => lines.push(line) });
    logger.info({ dek, provider, nested: { dek } }, 'keys');
    const outputs = [
      String(dek),
      JSON.stringify({ dek, provider }),
      inspect({ dek, provider }, { depth: 10, showHidden: true }),
      lines.join(''),
    ];
    for (const output of outputs) expect(leaks(output)).toEqual([]);
    expect(String(dek)).toBe('[REDACTED]');
  });

  it('errors from every failure path carry no key material', async () => {
    const wrapped = await wrapDek(provider, KEK_ID, dek, WS_A);
    const { all } = await encrypt(randomBytes(100), { dek, chunkSize: 32 });
    const bad = Buffer.from(all);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    const errors = [
      await failure(unwrapDek(provider, KEK_ID, wrapped, WS_B)),
      await failure(unwrapDek(provider, 'kek-x', wrapped, WS_A)),
      await failure(decrypt([bad], { dek })),
      await failure(decrypt([all], { dek: generateDek() })),
    ];
    for (const error of errors) {
      expect(isStorageCryptoError(error)).toBe(true);
      expect(error.cause).toBeUndefined();
      const text = `${error.message}\n${error.stack ?? ''}\n${inspect(error)}\n${JSON.stringify(error)}`;
      expect(leaks(text)).toEqual([]);
      expect(text).not.toContain(wrapped.toString('hex'));
    }
  });
});
