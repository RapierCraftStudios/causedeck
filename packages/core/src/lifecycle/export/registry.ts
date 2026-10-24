// The exporter registry (#301, spike §4.2; docs/engineering/data-lifecycle.md). A workspace export
// is complete by construction: every tenant table in the cross-tenant registry (`TABLE_TESTS`,
// #19) is covered by exactly one registered exporter or by an exclusion with a written reason, and
// `pnpm test:export-coverage` fails CI otherwise. Later milestones register the exporters for their
// own tables (matters, documents, memory, drafts) next to the domain code.
import type { Queryable } from '@causedeck/db';
import type { ExportScope } from '@causedeck/db/schema';

/** What an exporter reads with: the requester, the workspace and the table being written. */
export interface ExportCtx {
  /** A root client (not a transaction): each page opens its own `withWorkspace` scope. */
  db: Queryable;
  workspaceId: string;
  userId: string;
  scope: ExportScope;
  /** One of the exporter's `tables`; `collect` yields that table's rows. */
  table: string;
}

/**
 * One domain's exporter. `collect` streams the rows of `ctx.table`, page by page, inside the
 * workspace's scope, and never holds a whole table.
 */
export interface Exporter {
  name: string;
  tables: string[];
  collect(ctx: ExportCtx): AsyncIterable<Record<string, unknown>>;
}

const exporters = new Map<string, Exporter>();

/** Register an exporter. A table may belong to one exporter only. */
export function registerExporter(exporter: Exporter): Exporter {
  if (exporters.has(exporter.name)) {
    throw new TypeError(`registerExporter: "${exporter.name}" is already registered`);
  }
  for (const other of exporters.values()) {
    const shared = exporter.tables.find((t) => other.tables.includes(t));
    if (shared !== undefined) {
      throw new TypeError(`registerExporter: ${shared} is already exported by "${other.name}"`);
    }
  }
  exporters.set(exporter.name, exporter);
  return exporter;
}

/** Registered exporters, in registration order. */
export function registeredExporters(): Exporter[] {
  return [...exporters.values()];
}

/** The exporter that owns `table`, if any. */
export function exporterFor(table: string): Exporter | undefined {
  return registeredExporters().find((e) => e.tables.includes(table));
}

/**
 * Tenant tables deliberately left out of an export, each with the reason. Adding one is a privacy
 * decision: the reason is shown in docs/engineering/data-lifecycle.md.
 */
export const EXPORT_EXCLUSIONS: Readonly<Record<string, string>> = {
  workspace_key:
    'Wrapped data-encryption key: secret key material, not user data. Files in the export are already decrypted.',
  job_effect:
    'Internal job idempotency ledger (job name, key, time); holds no user content and no personal data.',
  adapter_parse_run:
    'Operational parse-health metrics (counts, hall numbers, adapter version, #372); holds no user content and no personal data.',
  contribution_ledger:
    'Link from the workspace to a shared public court document it contributed (#485); holds no user content, and is withdrawn and erased with the workspace.',
  notice_match:
    'Derived link from a global official notice to a matter or forum of the workspace (#584); holds no user content, is recomputed from the public feed, and is erased with the workspace.',
  whatsapp_otp_challenge:
    'Short-lived (10 min) pending WhatsApp verification (#678): a hash of a one-time code, never exported; the verified link itself is exported, and the challenge is erased with the workspace.',
  ai_call_result:
    'Short-lived (24 h) retry cache of validated AI gateway outputs (#44); derived from records that are exported themselves, and erased with the workspace.',
};

/** Tables that also get a human-readable `data/<table>.csv` next to the JSON Lines file. */
export const CSV_TABLES: readonly string[] = [
  'organization',
  'member',
  'invitation',
  'audit_event',
  'notification_pref',
  'saas_invoice',
  'saas_invoice_line',
  'blob',
];

export interface ExportCoverage {
  /** Tenant tables with neither an exporter nor an exclusion. */
  uncovered: string[];
  /** Tables both exported and excluded. */
  conflicting: string[];
  /** Exported or excluded tables that are not tenant tables (renamed or dropped). */
  stale: string[];
}

/** Compare the registry with the tenant tables; every list empty means complete. */
export function exportCoverage(
  tenantTables: readonly string[],
  registered: readonly Exporter[] = registeredExporters(),
  exclusions: Readonly<Record<string, string>> = EXPORT_EXCLUSIONS,
): ExportCoverage {
  const exported = new Set(registered.flatMap((e) => e.tables));
  const excluded = new Set(
    Object.entries(exclusions)
      .filter(([, reason]) => reason.trim().length > 0)
      .map(([table]) => table),
  );
  const tenant = new Set(tenantTables);
  return {
    uncovered: tenantTables.filter((t) => !exported.has(t) && !excluded.has(t)).sort(),
    conflicting: [...exported].filter((t) => excluded.has(t)).sort(),
    stale: [...exported, ...Object.keys(exclusions)].filter((t) => !tenant.has(t)).sort(),
  };
}
