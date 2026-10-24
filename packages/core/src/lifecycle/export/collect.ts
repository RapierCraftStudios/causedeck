// Row and file sources for the export ZIP (#301). Rows become JSON Lines (one object per line,
// UTF-8) or RFC 4180 CSV with the same formula guard as the audit export (a cell a spreadsheet
// would run gets a leading quote). Files are the workspace's finalized, non-infected blobs, read as
// a stream and decrypted with the workspace DEK (`decryptForWorkspace`); plaintext objects from
// before blob encryption are passed through. Previous exports are never included in an export.
import { withWorkspace, type Queryable } from '@causedeck/db';
import {
  decryptForWorkspace,
  type KeyProvider,
  type ObjectKey,
  type ObjectStore,
} from '@causedeck/storage';
import { sql, type SQL } from 'drizzle-orm';

import { PAGE_SIZE } from './exporters.ts';
import type { ExportCtx, Exporter } from './registry.ts';

const encoder = new TextEncoder();

/** One JSON object per line. */
export async function* jsonLines(
  rows: AsyncIterable<Record<string, unknown>>,
): AsyncGenerator<Uint8Array> {
  for await (const row of rows) yield encoder.encode(`${JSON.stringify(row)}\n`);
}

// A cell a spreadsheet would read as a formula gets a leading quote (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const text = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvLine = (values: readonly unknown[]) => `${values.map(csvCell).join(',')}\r\n`;

/** CSV with a header row from the first row's columns; an empty table is an empty file. */
export async function* csvRows(
  rows: AsyncIterable<Record<string, unknown>>,
): AsyncGenerator<Uint8Array> {
  let columns: string[] | null = null;
  for await (const row of rows) {
    if (columns === null) {
      columns = Object.keys(row);
      yield encoder.encode(csvLine(columns));
    }
    yield encoder.encode(csvLine(columns.map((c) => row[c])));
  }
}

/** Count the rows that pass through. */
export function counted<T>(
  rows: AsyncIterable<T>,
  onDone: (count: number) => void,
): AsyncGenerator<T> {
  return (async function* () {
    let count = 0;
    for await (const row of rows) {
      count += 1;
      yield row;
    }
    onDone(count);
  })();
}

/** Rows of `table` from its exporter. */
export function tableRows(
  exporter: Exporter,
  ctx: Omit<ExportCtx, 'table'>,
  table: string,
): AsyncIterable<Record<string, unknown>> {
  return exporter.collect({ ...ctx, table });
}

export interface ExportFile {
  id: string;
  kind: string;
  filename: string;
  key: string;
  size: number;
  encrypted: boolean;
}

/** Path separators, control characters and characters Windows refuses in a name. */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;

/** `files/<kind>/<id>-<filename>`, with a name safe on every unzip tool. */
export function filePath(file: Pick<ExportFile, 'id' | 'kind' | 'filename'>): string {
  const name = file.filename.replace(UNSAFE_NAME, '_').replace(/^\.+/, '_').slice(0, 200);
  const kind = file.kind.replace(/[^a-z0-9_-]/g, '_');
  return `files/${kind}/${file.id}-${name || 'file'}`;
}

const fileFilter = (ctx: Omit<ExportCtx, 'table'>) =>
  sql`b.workspace_id = ${ctx.workspaceId}::uuid
    and b.finalized_at is not null
    and b.scan_status is distinct from 'infected'
    and b.kind <> 'export'
    ${ctx.scope === 'user' ? sql`and b.created_by = ${ctx.userId}::uuid` : sql``}`;

/** How many files `exportFiles` yields (for progress). */
export async function countExportFiles(ctx: Omit<ExportCtx, 'table'>): Promise<number> {
  const [row] = await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from blob b where ${fileFilter(ctx)}`),
  );
  return row?.n ?? 0;
}

/** The files to include: finalized, not infected, not an export; the requester's own for `user`. */
export async function* exportFiles(ctx: Omit<ExportCtx, 'table'>): AsyncGenerator<ExportFile> {
  let after: string | null = null;
  for (;;) {
    const cursor: SQL = after === null ? sql`` : sql`and b.id > ${after}::uuid`;
    const rows = await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, (tx) =>
      tx.execute<{
        id: string;
        kind: string;
        filename: string;
        key: string;
        size: string | number;
        encrypted: boolean;
      }>(sql`
        select b.id, b.kind, b.filename, b.key, b.size, b.enc_header is not null as encrypted
        from blob b
        where ${fileFilter(ctx)} ${cursor}
        order by b.id
        limit ${PAGE_SIZE}`),
    );
    for (const row of rows) yield { ...row, size: Number(row.size) };
    const last = rows.at(-1);
    if (last === undefined || rows.length < PAGE_SIZE) return;
    after = last.id;
  }
}

/** The plaintext of one file, streamed: decrypted with the workspace DEK when encrypted. */
export async function fileBody(
  deps: { db: Queryable; store: ObjectStore; keys: KeyProvider },
  workspaceId: string,
  file: ExportFile,
): Promise<AsyncIterable<Uint8Array>> {
  const { body } = await deps.store.getStream(file.key as ObjectKey);
  return file.encrypted ? decryptForWorkspace(deps.db, deps.keys, workspaceId, body) : body;
}
