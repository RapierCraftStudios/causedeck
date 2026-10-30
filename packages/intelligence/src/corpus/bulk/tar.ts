// Streaming tar reader for the dataset archives (#890): entries are yielded one at a time as the
// source is read, so an archive is never held whole. Reads ustar plus the GNU long-name and pax
// `path` extensions; anything else about an entry is ignored.
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

const BLOCK = 512;

const text = (buf: Uint8Array, from: number, to: number): string =>
  Buffer.from(buf.subarray(from, to)).toString('utf8').replace(/\0.*$/s, '');

/** The size field: octal digits, or GNU base-256 when the top bit of the first byte is set. */
function entrySize(header: Uint8Array): number {
  if (((header[124] ?? 0) & 0x80) !== 0) {
    let size = 0;
    for (let i = 125; i < 136; i += 1) size = size * 256 + (header[i] ?? 0);
    return size;
  }
  return Number.parseInt(text(header, 124, 136).trim() || '0', 8);
}

/** A gzip-wrapped archive is unwrapped on the fly; a plain tar passes through. */
export function gunzipIfNeeded(
  chunks: AsyncIterable<Uint8Array>,
  key: string,
): AsyncIterable<Uint8Array> {
  if (!/\.(tar\.gz|tgz)$/i.test(key)) return chunks;
  return Readable.from(chunks).pipe(createGunzip());
}

/** Regular-file entries of a tar stream, in archive order. */
export async function* readTar(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<TarEntry> {
  let buffer = Buffer.alloc(0);
  const queue: Buffer[] = [];
  const iterator = chunks[Symbol.asyncIterator]();
  let ended = false;

  /** Exactly `n` bytes, or fewer when the stream ends first. */
  async function take(n: number): Promise<Buffer> {
    while (buffer.length < n && !ended) {
      const next = await iterator.next();
      if (next.done === true) ended = true;
      else queue.push(Buffer.from(next.value));
      if (queue.length > 0) {
        buffer = Buffer.concat([buffer, ...queue.splice(0)]);
      }
    }
    const out = buffer.subarray(0, n);
    buffer = buffer.subarray(n);
    return out;
  }

  let longName: string | null = null;
  for (;;) {
    const header = await take(BLOCK);
    if (header.length < BLOCK || header.every((b) => b === 0)) return;
    const size = entrySize(header);
    const type = String.fromCharCode(header[156] ?? 0x30);
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    const body = await take(padded);
    if (body.length < padded) return;
    const data = body.subarray(0, size);

    if (type === 'L') {
      longName = text(data, 0, data.length);
      continue;
    }
    if (type === 'x') {
      const match = /\d+ path=([^\n]*)\n/.exec(Buffer.from(data).toString('utf8'));
      if (match?.[1] !== undefined) longName = match[1];
      continue;
    }
    if (type !== '0' && type !== '\0') {
      longName = null;
      continue;
    }
    const prefix = text(header, 345, 500);
    const name = longName ?? (prefix === '' ? '' : `${prefix}/`) + text(header, 0, 100);
    longName = null;
    yield { name, data: new Uint8Array(data) };
  }
}
