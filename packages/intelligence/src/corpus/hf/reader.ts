// Streaming reads of the HF dataset `overthelex/indian-court-decisions` (#1171, D-053): the file list
// from the Hub tree API, and Parquet files through HTTPS range reads (hyparquet `AsyncBuffer`), one
// row group at a time with column projection, so a run never holds a whole file. Every request and
// every redirect stays on the pinned Hugging Face hosts; the caller has already cleared the source
// through `policyFor`.
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

import type { HfConfig, HfRawRow } from './map.ts';

export interface HfFetchInit {
  headers?: Record<string, string>;
  redirect?: 'manual';
}
export type HfFetch = (url: string, init?: HfFetchInit) => Promise<Response>;

/**
 * The only hosts an HF import reads: the Hub (listing and `resolve/` URLs) and the CDN hosts a
 * `resolve/` URL redirects to (LFS and Xet storage). Another host, or plain HTTP, is refused, so
 * neither a source row nor a redirect can point the importer anywhere else.
 */
export const HF_DATASET_HOSTS: ReadonlySet<string> = new Set([
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs.hf.co',
  'cdn-lfs-us-1.hf.co',
  'cdn-lfs-eu-1.hf.co',
  'cas-bridge.xethub.hf.co',
]);

/** Redirect hops followed for one request. */
const MAX_REDIRECTS = 5;

export class HfHttpError extends Error {
  override name = 'HfHttpError';
  constructor(
    readonly status: number,
    reason = `HF read failed with HTTP ${String(status)}`,
  ) {
    super(reason);
  }
}

/** A Parquet file of the dataset: its repository path (`high_courts/train-00000-of-00042.parquet`). */
export interface HfParquetFile {
  path: string;
  size: number;
}

/** One opened Parquet file: its row-group layout and a reader of a row range. */
export interface HfOpenedFile {
  /** Rows in each row group, in file order. */
  rowGroups: readonly number[];
  /** Column names the file has (`petitioner`/`respondent` exist in the SC config only). */
  columns: readonly string[];
  /** Rows `[rowStart, rowEnd)`, decoding only `columns`; callers keep the range inside one row group. */
  readRows(rowStart: number, rowEnd: number, columns: readonly string[]): Promise<HfRawRow[]>;
}

/** Read access to the dataset. Paths are repository paths, never URLs. */
export interface HfDatasetSource {
  /** Every Parquet file of a config, in path order. */
  list(config: HfConfig): Promise<HfParquetFile[]>;
  open(file: HfParquetFile): Promise<HfOpenedFile>;
  /** Bytes read over the network so far (listing excluded). */
  bytesRead(): number;
}

const pinned = (url: URL): boolean => url.protocol === 'https:' && HF_DATASET_HOSTS.has(url.host);

/** `owner/name` of a `https://huggingface.co/datasets/<owner>/<name>/` base URL. */
export function hfRepoOf(baseUrl: string): string {
  const base = new URL(baseUrl);
  const match = /^\/datasets\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(base.pathname);
  if (base.protocol !== 'https:' || base.host !== 'huggingface.co' || match === null) {
    throw new HfHttpError(0, 'HF base URL is not a pinned dataset URL');
  }
  return `${match[1] ?? ''}/${match[2] ?? ''}`;
}

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

export function createHfHttpSource(
  baseUrl: string,
  // nosemgrep: infra.security.semgrep.causedeck.fetch-to-unlisted-host -- anonymous reads pinned to HF_DATASET_HOSTS below, redirects followed by hand
  fetchFn: HfFetch = (url, init) => fetch(url, init),
): HfDatasetSource {
  const repo = hfRepoOf(baseUrl);
  let bytes = 0;

  /** GET with redirects followed only onto pinned hosts. */
  const get = async (url: string, headers: Record<string, string> = {}): Promise<Response> => {
    let target = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!pinned(target)) throw new HfHttpError(0, 'HF read refused: host is not pinned');
      const response = await fetchFn(target.toString(), { headers, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) throw new HfHttpError(response.status);
        target = new URL(location, target);
        continue;
      }
      if (!response.ok) throw new HfHttpError(response.status);
      return response;
    }
    throw new HfHttpError(0, 'HF read refused: too many redirects');
  };

  const resolveUrl = (path: string): string =>
    `https://huggingface.co/datasets/${repo}/resolve/main/${encodePath(path)}`;

  /** A range-read buffer over one file; each slice is one `Range` request. */
  const asyncBufferOf = (file: HfParquetFile): AsyncBuffer => ({
    byteLength: file.size,
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      const last = (end ?? file.size) - 1;
      const response = await get(resolveUrl(file.path), {
        range: `bytes=${String(start)}-${String(last)}`,
      });
      let body = new Uint8Array(await response.arrayBuffer());
      // A server that ignores Range sends the whole file: keep only the requested bytes.
      if (response.status === 200 && body.byteLength > last - start + 1) {
        body = body.slice(start, last + 1);
      }
      bytes += body.byteLength;
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  });

  return {
    async list(config) {
      const files: HfParquetFile[] = [];
      let next: string | null =
        `https://huggingface.co/api/datasets/${repo}/tree/main/${encodePath(config)}?recursive=true`;
      while (next !== null) {
        const response = await get(next);
        const entries = (await response.json()) as {
          type?: string;
          path?: string;
          size?: number;
        }[];
        for (const e of entries) {
          if (e.type !== 'file' || typeof e.path !== 'string' || !e.path.endsWith('.parquet'))
            continue;
          files.push({ path: e.path, size: e.size ?? 0 });
        }
        const link = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '');
        next = link?.[1] ?? null;
      }
      return files.sort((a, b) => a.path.localeCompare(b.path));
    },
    async open(file) {
      const buffer = asyncBufferOf(file);
      const metadata = await parquetMetadataAsync(buffer);
      const columns = metadata.schema.slice(1).map((s) => s.name);
      return {
        rowGroups: metadata.row_groups.map((rg) => Number(rg.num_rows)),
        columns,
        async readRows(rowStart, rowEnd, wanted) {
          return (await parquetReadObjects({
            file: buffer,
            metadata,
            columns: wanted.filter((c) => columns.includes(c)),
            rowStart,
            rowEnd,
            compressors,
          })) as HfRawRow[];
        },
      };
    },
    bytesRead: () => bytes,
  };
}
