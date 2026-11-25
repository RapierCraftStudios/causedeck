import { describe, expect, it } from 'vitest';

import { readTar } from './tar.ts';

const BLOCK = 512;

function header(name: string, size: number, type = '0', prefix = ''): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 'utf8');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  block.write(type, 156, 'ascii');
  if (prefix !== '') block.write(prefix, 345, 'utf8');
  return block;
}

const pad = (size: number): Buffer => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

function entry(name: string, body: Uint8Array, type = '0', prefix = ''): Buffer[] {
  return [header(name, body.length, type, prefix), Buffer.from(body), pad(body.length)];
}

/** Deterministic bytes, distinct per seed, so a misplaced byte shows. */
function bytes(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (i * 31 + seed * 17) & 0xff;
  return out;
}

const LONG_NAME = `${'deep/'.repeat(30)}judgment-with-a-very-long-name.pdf`;
const PAX_NAME = `${'pax/'.repeat(40)}pax-named.pdf`;

/** Entries ending exactly on a block, one short of it, one past it, empty, large, plus extensions. */
const files: { name: string; data: Uint8Array }[] = [
  { name: 'block.pdf', data: bytes(BLOCK, 1) },
  { name: 'short.pdf', data: bytes(BLOCK - 1, 2) },
  { name: 'over.pdf', data: bytes(BLOCK + 1, 3) },
  { name: 'empty.pdf', data: new Uint8Array(0) },
  { name: 'big.pdf', data: bytes(200_000, 4) },
  { name: 'chunk.pdf', data: bytes(65_536, 5) },
];

function archive(): Uint8Array {
  const parts: Buffer[] = [];
  for (const f of files) parts.push(...entry(f.name, f.data));
  parts.push(...entry('././@LongLink', Buffer.from(`${LONG_NAME}\0`), 'L'));
  parts.push(...entry('ignored', bytes(700, 6)));
  // `<length> path=<name>\n`: three length digits, a space, `path=`, the name and the newline.
  const pax = `${String(PAX_NAME.length + 10)} path=${PAX_NAME}\n`;
  parts.push(...entry('PaxHeader', Buffer.from(pax), 'x'));
  parts.push(...entry('ignored-too', bytes(1000, 7)));
  parts.push(...entry('file.pdf', bytes(10, 8), '0', 'some/prefix'));
  parts.push(...entry('dir/', new Uint8Array(0), '5'));
  parts.push(Buffer.alloc(2 * BLOCK));
  return Buffer.concat(parts);
}

const expected = [
  ...files,
  { name: LONG_NAME, data: bytes(700, 6) },
  { name: PAX_NAME, data: bytes(1000, 7) },
  { name: 'some/prefix/file.pdf', data: bytes(10, 8) },
];

async function* chunked(all: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  // Each chunk is its own buffer, as a network stream hands them out.
  for (let i = 0; i < all.length; i += size) {
    yield Uint8Array.from(all.subarray(i, i + size));
    await Promise.resolve();
  }
}

async function read(all: Uint8Array, size: number) {
  const pending: number[] = [];
  const out: { name: string; data: Uint8Array }[] = [];
  for await (const e of readTar(chunked(all, size), (n) => pending.push(n))) out.push(e);
  return { out, pending };
}

describe('readTar', () => {
  for (const size of [1, 511, 512, 513, 700, 65_536]) {
    it(`reads every entry byte-exactly with ${String(size)}-byte chunks, holding at most one chunk`, async () => {
      const { out, pending } = await read(archive(), size);
      expect(out.map((e) => e.name)).toEqual(expected.map((e) => e.name));
      for (const [i, e] of out.entries()) {
        expect(Buffer.from(e.data).equals(Buffer.from(expected[i]?.data ?? [])), e.name).toBe(true);
        // The entry owns its memory: no view into a source chunk or a growing buffer.
        expect(e.data.byteOffset).toBe(0);
        expect(e.data.buffer.byteLength).toBe(e.data.byteLength);
      }
      expect(pending.length).toBeGreaterThan(0);
      expect(Math.max(...pending)).toBeLessThanOrEqual(size + BLOCK);
      // Consumed chunks are released: never more than one partly read chunk is pending.
      expect(Math.max(...pending)).toBeLessThan(size);
    });
  }

  it('reads an archive whose entries end exactly on chunk boundaries', async () => {
    const all = Buffer.concat([
      ...entry('a.pdf', bytes(BLOCK, 9)),
      ...entry('b.pdf', bytes(3 * BLOCK, 10)),
      Buffer.alloc(2 * BLOCK),
    ]);
    // 1024-byte chunks: header+body of a.pdf is exactly one chunk.
    const { out, pending } = await read(all, 2 * BLOCK);
    expect(out.map((e) => [e.name, e.data.length])).toEqual([
      ['a.pdf', BLOCK],
      ['b.pdf', 3 * BLOCK],
    ]);
    expect(Math.max(...pending)).toBeLessThan(2 * BLOCK);
  });

  it('ends cleanly on a truncated stream', async () => {
    const all = archive();
    for (const cut of [100, BLOCK, BLOCK + 10, 5000, 270_000]) {
      const names: string[] = [];
      for await (const e of readTar(chunked(all.subarray(0, cut), 700))) names.push(e.name);
      expect(names.length).toBeLessThan(expected.length);
      expect(names).toEqual(expected.slice(0, names.length).map((e) => e.name));
    }
  });

  it('ends on an empty stream', async () => {
    const names: string[] = [];
    for await (const e of readTar(chunked(new Uint8Array(0), 512))) names.push(e.name);
    expect(names).toEqual([]);
  });
});
