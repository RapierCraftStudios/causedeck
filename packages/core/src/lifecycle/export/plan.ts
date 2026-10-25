// The export plan (#301): which tables go into the archive, in which order, and which of them also
// get a CSV. Every registered exporter's tables are included, so the archive has a JSON Lines file
// for every registered table even when it is empty (a `user` scope export leaves the tables that
// name no user empty). Original files follow the data, then the manifest.
import type { ExportScope } from '@causedeck/db/schema';

import './exporters.ts';
import { CSV_TABLES, EXPORT_EXCLUSIONS, registeredExporters, type Exporter } from './registry.ts';

export interface PlannedTable {
  table: string;
  exporter: Exporter;
  csv: boolean;
}

export interface ExportPlan {
  scope: ExportScope;
  tables: PlannedTable[];
  excluded: Record<string, string>;
}

export function planExport(scope: ExportScope): ExportPlan {
  const tables = registeredExporters().flatMap((exporter) =>
    exporter.tables.map((table) => ({ table, exporter, csv: CSV_TABLES.includes(table) })),
  );
  return { scope, tables, excluded: { ...EXPORT_EXCLUSIONS } };
}

export const jsonlPath = (table: string) => `data/${table}.jsonl`;
export const csvPath = (table: string) => `data/${table}.csv`;

/** Entries before the files: README plus one or two per table. */
export function dataEntryCount(plan: ExportPlan): number {
  return 1 + plan.tables.reduce((n, t) => n + (t.csv ? 2 : 1), 0);
}
