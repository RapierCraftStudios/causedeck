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
  // API keys (#624): the name, prefix, scopes and limits; the token hash is a secret.
  ws('api_key', { exclude: ['token_hash'], userColumn: 'created_by' }),
  // Email forward-in intake (#54): the member's address and sender allow-list; the message ledger
  // leaves out the raw MIME object's key, which is internal like `blob.key`.
  ws('intake_address', { userColumn: 'user_id' }),
  ws('intake_allowlist', { userColumn: 'added_by' }),
  ws('intake_message', { exclude: ['raw_mime_ref'] }),
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
  // News digest (#481): the member's followed practice areas and forums and their digest time.
  ws('news_pref', { keys: ['user_id'], userColumn: 'user_id' }),
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
  // The capture inbox (#43): the raw object's key is internal, like `blob.key`; the file itself
  // comes with the blobs while retention has not deleted it.
  ws('capture', { exclude: ['raw_storage_key'], userColumn: 'created_by' }),
  ws('workspace_capture_channel', { keys: ['channel'], userColumn: 'enabled_by' }),
  // Calendar interop (#53): the feed's token hash is a credential and never leaves; the import
  // ledger holds only the hearing-like events' own text.
  ws('ics_feed', { exclude: ['token_hash'], userColumn: 'user_id' }),
  ws('ics_feed_event', { keys: ['feed_id', 'uid'] }),
  ws('ics_import_event'),
  // Bootstrap import (#546): batches, their files and the matched-rows plan (while not yet purged).
  ws('import_batch', { userColumn: 'created_by' }),
  ws('import_batch_file'),
  ws('import_plan', { keys: ['batch_id'] }),
  // The importing member's own identifiers (#550).
  ws('advocate_profile', { userColumn: 'user_id' }),
  ws('cause_list_watch', { userColumn: 'user_id' }),
  // Case-status watch (#589): the advocate's watches and the status snapshots they took.
  ws('case_watch', { userColumn: 'advocate_user_id' }),
  ws('case_status_snapshot'),
  // Corrections CauseDeck review fanned out to this workspace's watched proceedings (#518).
  ws('review_correction'),
]);

export const lifecycleExporter = tablesExporter('lifecycle', [
  ws('export_job', { exclude: ['download_token_hash'], userColumn: 'requested_by' }),
  ws('deletion_job', { userColumn: 'requested_by' }),
]);

// A workspace's custom court reference rows (#344): the forums, halls and benches it added itself,
// and its own bench rosters, their entries and bench-change alerts (#384). The system catalogue
// (null workspace_id) is public reference data, not the workspace's, so it is not exported.
// Workspace-wide only: the rows name no user (`imported_by` is a member id).
export const courtExporter = tablesExporter('court', [
  ws('forum'),
  ws('court_hall'),
  ws('bench'),
  ws('bench_roster'),
  ws('bench_roster_entry'),
  ws('bench_change_alert'),
]);

// Matters, their proceedings, links (#346) and state history (#363), their docket: listings, hearings, appearances,
// orders, obligations and tasks (#347), the people and role edges around them (#348) and their
// documents (#345). A document's storage key is an internal object key (like `blob.key`), so it is
// left out; the files themselves come with the blobs.
export const mattersExporter = tablesExporter('matters', [
  ws('matter'),
  ws('proceeding'),
  ws('proceeding_link'),
  ws('proceeding_state_change'),
  ws('listing'),
  ws('hearing'),
  ws('appearance'),
  ws('order'),
  ws('obligation'),
  ws('task'),
  ws('person'),
  ws('organisation'),
  ws('role_edge'),
  ws('document', { exclude: ['storage_key'] }),
  ws('document_page'),
  ws('anchor'),
  // Anchored order extractions (#46): the validated result and what was rejected, with quotes.
  ws('extraction'),
  // Judgment alerts (#497): the lawyer's own issue tags on a matter (statute, section, issue) and
  // the alerts raised against confirmed tags. The alert carries ids and a page number only; the
  // judgment itself is global corpus data, not the workspace's.
  ws('matter_issue_tag'),
  ws('judgment_alert'),
]);

// What the automation engine did and proposed (#47): proposals, the activity feed with its undo
// state, and the user's ask-first dials and learned thresholds. Ids, kinds and the short summaries
// the person already sees; no document text.
export const automationExporter = tablesExporter('automation', [
  ws('proposal'),
  ws('activity', { userColumn: 'actor_user_id' }),
  ws('automation_preference', { userColumn: 'user_id' }),
  ws('automation_threshold'),
]);

// Change webhooks (#626): the workspace's own receivers and the delivery history of each event.
// The signing secret is a credential and never leaves, so it is dropped from the endpoint; the
// customer can rotate by recreating the endpoint. A delivery holds a content-free payload (ids and
// change kinds, D-048) with its status, attempts and timestamps.
export const webhooksExporter = tablesExporter('webhooks', [
  ws('webhook_endpoint', { exclude: ['secret'], userColumn: 'created_by' }),
  ws('webhook_delivery'),
]);

// Institution portfolios (#661): the portfolios, their tracked cases (status, next date, last
// adverse order) and the panel advocates delegated for them. Ids, short references and dates.
const portfoliosExporter = tablesExporter('portfolios', [
  ws('portfolio', { userColumn: 'created_by' }),
  ws('portfolio_case'),
  ws('portfolio_panel_advocate', { userColumn: 'advocate_user_id' }),
]);

// WhatsApp number link (#678): the member's own linked number, opt-in time and chosen categories.
// The pending challenge holds only a code hash and is never exported.
const whatsappLinkExporter = tablesExporter('whatsapp-link', [
  ws('whatsapp_link', { userColumn: 'user_id' }),
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
  automationExporter,
  webhooksExporter,
  portfoliosExporter,
  whatsappLinkExporter,
];

for (const exporter of PLATFORM_EXPORTERS) registerExporter(exporter);
