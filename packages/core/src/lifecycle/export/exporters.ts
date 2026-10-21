// The platform exporters (#301): workspace, members, settings, audit events, notification
// preferences, billing metadata and invoices, blobs and lifecycle history. Every page is a keyset
// read of at most `PAGE_SIZE` rows in its own `withWorkspace` transaction, so FORCE row-level
// security keeps each read in the requesting workspace and memory stays bounded. The explicit
// workspace filter repeats what RLS enforces. Secrets never leave: invitation token hashes, export
// download token hashes, raw billing webhook payloads and envelope headers are dropped. A `user`
// scope export keeps only the requester's own rows of the tables that name a user.
import { withWorkspace } from '@causedeck/db';
import { sql, type SQL } from 'drizzle-orm';

import { queryAudit } from '../../audit/index.ts';

import { registerExporter, type ExportCtx, type Exporter } from './registry.ts';

/** Rows per page. */
export const PAGE_SIZE = 500;

interface TableSpec {
  table: string;
  /** Column holding the workspace id (`organization` uses `id`). */
  workspaceColumn: string;
  /** Unique, ordered keyset columns. */
  keys: readonly string[];
  /** Columns never exported. */
  exclude?: readonly string[];
  /** The column naming the user a row belongs to; tables without one are skipped for `user` scope. */
  userColumn?: string;
}

const ident = (name: string) => sql.identifier(name);

/** Stream one table's rows as JSON objects (`row_to_json`), keyset-paged on `spec.keys`. */
async function* pageTable(
  ctx: ExportCtx,
  spec: TableSpec,
): AsyncGenerator<Record<string, unknown>> {
  if (ctx.scope === 'user' && spec.userColumn === undefined) return;
  const keys = sql.join(
    spec.keys.map((k) => sql`t.${ident(k)}`),
    sql`, `,
  );
  const exclude = spec.exclude ?? [];
  const userFilter: SQL =
    ctx.scope === 'user' && spec.userColumn !== undefined
      ? sql`and t.${ident(spec.userColumn)} = ${ctx.userId}::uuid`
      : sql``;
  let after: unknown[] | null = null;
  for (;;) {
    const cursor: SQL =
      after === null
        ? sql``
        : sql`and (${keys}) > (${sql.join(
            after.map((v) => sql`${v}`),
            sql`, `,
          )})`;
    const rows = await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, (tx) =>
      tx.execute<{ row: Record<string, unknown>; k: unknown[] }>(sql`
        select row_to_json(t) as row,
               jsonb_build_array(${keys}) as k
        from ${ident(spec.table)} t
        where t.${ident(spec.workspaceColumn)} = ${ctx.workspaceId}::uuid ${userFilter} ${cursor}
        order by ${keys}
        limit ${PAGE_SIZE}`),
    );
    for (const { row } of rows) {
      // `row_to_json` keeps the table's column order (jsonb would sort the keys).
      yield exclude.length === 0
        ? row
        : Object.fromEntries(Object.entries(row).filter(([column]) => !exclude.includes(column)));
    }
    const last = rows.at(-1);
    if (last === undefined || rows.length < PAGE_SIZE) return;
    after = last.k;
  }
}

/** An exporter over plain table specs. */
function tablesExporter(name: string, specs: readonly TableSpec[]): Exporter {
  const byTable = new Map(specs.map((s) => [s.table, s]));
  return {
    name,
    tables: specs.map((s) => s.table),
    collect(ctx) {
      const spec = byTable.get(ctx.table);
      if (spec === undefined) throw new RangeError(`exporter ${name} has no table ${ctx.table}`);
      return pageTable(ctx, spec);
    },
  };
}

const ws = (table: string, extra: Partial<TableSpec> = {}): TableSpec => ({
  table,
  workspaceColumn: 'workspace_id',
  keys: ['id'],
  ...extra,
});

/** Members with the name, email and role of each (from the global `user` table). */
async function* members(ctx: ExportCtx): AsyncGenerator<Record<string, unknown>> {
  const userFilter = ctx.scope === 'user' ? sql`and m.user_id = ${ctx.userId}::uuid` : sql``;
  let after: string | null = null;
  for (;;) {
    const cursor: SQL = after === null ? sql`` : sql`and m.id > ${after}::uuid`;
    const rows = await withWorkspace(ctx.db, { workspaceId: ctx.workspaceId }, (tx) =>
      tx.execute<{ row: Record<string, unknown>; id: string }>(sql`
        select json_build_object(
                 'id', m.id, 'user_id', m.user_id, 'name', u.name, 'email', u.email,
                 'role', m.role, 'status', m.status, 'joined_at', m.joined_at,
                 'created_at', m.created_at) as row,
               m.id as id
        from member m join "user" u on u.id = m.user_id
        where m.workspace_id = ${ctx.workspaceId}::uuid ${userFilter} ${cursor}
        order by m.id
        limit ${PAGE_SIZE}`),
    );
    for (const { row } of rows) yield row;
    const last = rows.at(-1);
    if (last === undefined || rows.length < PAGE_SIZE) return;
    after = last.id;
  }
}

/** Audit events per page (the feed's maximum). */
const AUDIT_PAGE_SIZE = 200;

/**
 * The workspace audit log through the audit read path (`queryAudit`, the view the activity feed
 * and audit export serve), newest first, as owners see it (IP included, truncated for display).
 * The requester is an owner, so `audit.read` always holds.
 */
async function* auditEvents(ctx: ExportCtx): AsyncGenerator<Record<string, unknown>> {
  let cursor: string | undefined;
  for (;;) {
    const page = await queryAudit(
      { db: ctx.db, workspaceId: ctx.workspaceId, userId: ctx.userId },
      {
        limit: AUDIT_PAGE_SIZE,
        ...(ctx.scope === 'user' ? { actorUserId: ctx.userId } : {}),
        ...(cursor === undefined ? {} : { cursor }),
      },
    );
    for (const event of page.events) yield { ...event };
    if (page.nextCursor === null) return;
    cursor = page.nextCursor;
  }
}

const AUDIT_SPECS: readonly TableSpec[] = [
  ws('ai_call', { userColumn: 'user_id' }),
  // Staff support sessions (#308): who asked for access, why, and who granted it for how long.
  ws('support_session', { userColumn: 'granted_by_user' }),
];

export const workspaceExporter = tablesExporter('workspace', [
  { table: 'organization', workspaceColumn: 'id', keys: ['id'] },
  ws('workspace_slug_history'),
]);

export const membersExporter: Exporter = {
  name: 'members',
  tables: ['member', 'invitation'],
  collect(ctx) {
    if (ctx.table === 'member') return members(ctx);
    return pageTable(ctx, ws('invitation', { exclude: ['token_hash'] }));
  },
};

export const settingsExporter = tablesExporter('settings', [
  ws('workspace_settings', { keys: ['workspace_id'] }),
  ws('workspace_feature_flag', { keys: ['key'] }),
  ws('matter_restriction'),
  // Integration tokens (#287): the kind and dates only; the token hash is a secret.
  ws('workspace_integration', { exclude: ['token_hash'] }),
]);

export const auditExporter: Exporter = {
  name: 'audit',
  tables: ['audit_event', 'ai_call', 'support_session'],
  collect(ctx) {
    if (ctx.table === 'audit_event') return auditEvents(ctx);
    return tablesExporter('audit', AUDIT_SPECS).collect(ctx);
  },
};

export const notificationsExporter = tablesExporter('notifications', [
  ws('notification_pref', {
    keys: ['user_id', 'category', 'channel'],
    userColumn: 'user_id',
  }),
  ws('notification_setting', { keys: ['user_id'], userColumn: 'user_id' }),
  ws('notification', { userColumn: 'user_id' }),
]);

export const billingExporter = tablesExporter('billing', [
  ws('subscription'),
  ws('entitlement', { keys: ['key'] }),
  // The raw provider payload can carry provider-side detail; its hash and type are kept.
  ws('billing_event', { keys: ['provider_event_id'], exclude: ['payload'] }),
  ws('saas_invoice'),
  ws('saas_invoice_line'),
  ws('usage_counter', { keys: ['key', 'period_start'] }),
  ws('usage_event'),
  ws('usage_reservation'),
  ws('budget_override'),
  ws('usage_period_summary', { keys: ['key', 'period_start'] }),
]);

export const blobsExporter = tablesExporter('blobs', [
  ws('blob', { exclude: ['enc_header', 'key'], userColumn: 'created_by' }),
]);

export const lifecycleExporter = tablesExporter('lifecycle', [
  ws('export_job', { exclude: ['download_token_hash'], userColumn: 'requested_by' }),
  ws('deletion_job', { userColumn: 'requested_by' }),
]);

// A workspace's custom court reference rows (#344): the forums, halls and benches it added itself.
// The system catalogue (null workspace_id) is public reference data, not the workspace's, so it is
// not exported. Workspace-wide only: the rows name no user.
export const courtExporter = tablesExporter('court', [ws('forum'), ws('court_hall'), ws('bench')]);

// Matters, their proceedings and links (#346) and their documents (#345). A document's storage key
// is an internal object key (like `blob.key`), so it is left out; the files themselves come with the
// blobs.
export const mattersExporter = tablesExporter('matters', [
  ws('matter'),
  ws('proceeding'),
  ws('proceeding_link'),
  ws('document', { exclude: ['storage_key'] }),
  ws('document_page'),
  ws('anchor'),
]);

/** The platform exporters, registered once per process. */
export const PLATFORM_EXPORTERS: readonly Exporter[] = [
  workspaceExporter,
  membersExporter,
  settingsExporter,
  auditExporter,
  notificationsExporter,
  billingExporter,
  blobsExporter,
  lifecycleExporter,
  courtExporter,
  mattersExporter,
];

for (const exporter of PLATFORM_EXPORTERS) registerExporter(exporter);
