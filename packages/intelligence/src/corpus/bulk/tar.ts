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

/**
 * Regular-file entries of a tar stream, in archive order. The reader holds only the source chunks it
 * has not consumed yet: each header and entry body is copied out into its own buffer and a source
 * chunk is dropped as soon as it is fully read, so memory stays at about one chunk plus the current
 * entry (#1185). `probe`, for tests, sees the pending byte count after every read.
 */
export async function* readTar(
  chunks: AsyncIterable<Uint8Array>,
  probe?: (pendingBytes: number) => void,
): AsyncGenerator<TarEntry> {
  const pending: Uint8Array[] = [];
  /** Bytes of `pending[0]` already consumed. */
  let offset = 0;
  /** Unconsumed bytes across `pending`. */
  let available = 0;
  const iterator = chunks[Symbol.asyncIterator]();
  let ended = false;

  /** Pull one more chunk when nothing is pending; false once the stream has ended. */
  async function pull(): Promise<boolean> {
    while (available === 0 && !ended) {
      const next = await iterator.next();
      if (next.done === true) ended = true;
      else if (next.value.byteLength > 0) {
        pending.push(next.value);
        available += next.value.byteLength;
      }
    }
    return available > 0;
  }

  /**
   * Consume `n` bytes, copying them into `into` when given, one source chunk at a time: a chunk is
   * dropped once fully read, so at most one partly read chunk is pending. False when the stream ends
   * first.
   */
  async function consume(n: number, into?: Uint8Array): Promise<boolean> {
    let done = 0;
    while (done < n) {
      if (!(await pull())) return false;
      const head = pending[0];
      if (head === undefined) return false;
      const count = Math.min(head.byteLength - offset, n - done);
      into?.set(head.subarray(offset, offset + count), done);
      done += count;
      offset += count;
      available -= count;
      if (offset === head.byteLength) {
        pending.shift();
        offset = 0;
      }
    }
    probe?.(available);
    return true;
  }

  /** Exactly `n` bytes in a fresh buffer that owns its memory, or null when the stream ends first. */
  async function take(n: number): Promise<Uint8Array | null> {
    const out = new Uint8Array(n);
    return (await consume(n, out)) ? out : null;
  }

  let longName: string | null = null;
  for (;;) {
    const header = await take(BLOCK);
    if (header === null || header.every((b) => b === 0)) return;
    const size = entrySize(header);
    const type = String.fromCharCode(header[156] ?? 0x30);
    const data = await take(size);
    if (data === null) return;
    if (!(await consume(Math.ceil(size / BLOCK) * BLOCK - size))) return;

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
    yield { name, data };
  }
}
