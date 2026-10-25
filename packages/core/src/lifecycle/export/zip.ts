// The streaming ZIP writer for exports (#301), over `archiver`. Entries are added one at a time:
// each source streams through a sha256 and byte counter into the archive, and `add` resolves once
// the archive has consumed the whole entry, so at most one entry is in flight and memory stays
// bounded (backpressure comes from whoever reads `output`). ZIP64 is used automatically for large
// archives.
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import archiver from 'archiver';

export interface ZipEntryRecord {
  path: string;
  /** Hex sha256 of the entry's uncompressed bytes. */
  sha256: string;
  bytes: number;
}

export interface ZipWriter {
  /** The archive bytes; read it concurrently with `add`, or `add` never resolves. */
  readonly output: AsyncIterable<Uint8Array>;
  add(path: string, source: AsyncIterable<Uint8Array> | Uint8Array): Promise<ZipEntryRecord>;
  /** Write the central directory and end the output. */
  finish(): Promise<void>;
  /** Fail the output (the reader sees `error`). */
  abort(error: Error): void;
}

export function createZipWriter(options: { date?: Date } = {}): ZipWriter {
  const archive = archiver('zip', { zlib: { level: 6 } });
  let failure: Error | null = null;
  archive.on('error', (error) => {
    failure ??= error;
  });

  const add = (
    path: string,
    source: AsyncIterable<Uint8Array> | Uint8Array,
  ): Promise<ZipEntryRecord> => {
    if (failure) return Promise.reject(failure);
    const hash = createHash('sha256');
    let bytes = 0;
    const chunks = source instanceof Uint8Array ? [source] : source;
    async function* hashed(): AsyncGenerator<Uint8Array> {
      for await (const chunk of chunks) {
        hash.update(chunk);
        bytes += chunk.byteLength;
        yield chunk;
      }
    }
    return new Promise<ZipEntryRecord>((resolve, reject) => {
      const stream = Readable.from(hashed(), { objectMode: false });
      const cleanup = () => {
        archive.off('entry', onEntry);
        archive.off('error', onError);
        stream.off('error', onError);
      };
      const onEntry = (entry: archiver.EntryData) => {
        if (entry.name !== path) return;
        cleanup();
        resolve({ path, sha256: hash.digest('hex'), bytes });
      };
      const onError = (error: Error) => {
        cleanup();
        failure ??= error;
        archive.abort();
        reject(error);
      };
      archive.on('entry', onEntry);
      archive.on('error', onError);
      stream.on('error', onError);
      archive.append(stream, { name: path, ...(options.date ? { date: options.date } : {}) });
    });
  };

  return {
    output: archive,
    add,
    async finish() {
      if (failure) throw failure;
      await archive.finalize();
    },
    abort(error) {
      failure ??= error;
      archive.destroy(error);
    },
  };
}
