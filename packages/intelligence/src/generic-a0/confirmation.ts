// The A0 confirmation grid (#56): the model and server logic behind the table a lawyer confirms
// before anything is proposed. Rows are grouped with the columns case number, parties, court/hall
// if present, stage text and date, each with its confidence and issues, and the person Confirms,
// Edits or Skips each one. One confirmed row of a list raises the display confidence of the rest of
// that list to at most 0.95; it never changes the level (A0 is always L2). The inbox and the
// bootstrap import UIs (#48, #57) consume this; this issue ships no UI.
import {
  A0_CONFIDENCE_CAP,
  A0_CONFIRMED_CAP,
  partyAliases,
  type A0Issue,
  type A0ParsedList,
  type A0Row,
} from './validate.ts';

export const GRID_COLUMNS = ['caseNumber', 'parties', 'courtHall', 'stageText', 'date'] as const;
export type GridColumn = (typeof GRID_COLUMNS)[number];

export type GridAction = 'confirm' | 'edit' | 'skip';
export type GridRowStatus = 'pending' | 'confirmed' | 'edited' | 'skipped';

/** The values a person may change in the grid (the case number, parties, hall, stage and date). */
export type GridEdit = Partial<Record<GridColumn, string>>;

export interface GridCell {
  column: GridColumn;
  /** What the document says; a cell the row has no value for is null. */
  value: string | null;
}

export interface GridRow {
  key: string;
  cells: GridCell[];
  /** What the person sees, never above 0.95 and never above 0.85 before a row is confirmed. */
  confidence: number;
  issues: A0Issue[];
  status: GridRowStatus;
  /** The original row, kept for the correction diff and the proposal. */
  source: A0Row;
  edit?: GridEdit;
}

export interface ConfirmationGrid {
  forumCode: string;
  listDate: string | null;
  columns: readonly GridColumn[];
  /** The court/hall column is shown only when at least one row has a hall. */
  showCourtHall: boolean;
  rows: GridRow[];
  /** A row of this list has been confirmed: display confidence may reach 0.95. */
  listConfirmed: boolean;
}

/** Display confidence: before a confirmed row at most 0.85, after one at most 0.95 (L2 either way). */
export function displayConfidence(row: A0Row, listConfirmed: boolean): number {
  const raw = row.confidence + (listConfirmed ? 0.1 : 0);
  return Math.min(
    listConfirmed ? A0_CONFIRMED_CAP : A0_CONFIDENCE_CAP,
    Math.round(raw * 1000) / 1000,
  );
}

function cellsOf(row: A0Row): GridCell[] {
  const caseNumber =
    row.caseRef === undefined
      ? (row.cnr ?? null)
      : `${row.caseRef.caseTypeRaw} ${row.caseRef.caseNumber}/${String(row.caseRef.caseYear)}`;
  return [
    { column: 'caseNumber', value: caseNumber },
    { column: 'parties', value: row.parties?.original ?? null },
    { column: 'courtHall', value: row.hall ?? null },
    { column: 'stageText', value: row.stageText ?? null },
    { column: 'date', value: row.dates?.[0]?.iso ?? null },
  ];
}

/** Group a parsed list into the grid, every row pending. */
export function buildConfirmationGrid(list: A0ParsedList): ConfirmationGrid {
  return {
    forumCode: list.forumCode,
    listDate: list.listDate?.iso ?? null,
    columns: GRID_COLUMNS,
    showCourtHall: list.rows.some((r) => r.hall !== undefined),
    rows: list.rows.map((source) => ({
      key: source.key,
      cells: cellsOf(source),
      confidence: displayConfidence(source, false),
      issues: source.issues,
      status: 'pending',
      source,
    })),
    listConfirmed: false,
  };
}

/** Apply Confirm, Edit or Skip to one row; the first Confirm or Edit confirms the list. */
export function applyGridAction(
  grid: ConfirmationGrid,
  key: string,
  action: GridAction,
  edit?: GridEdit,
): ConfirmationGrid {
  const target = grid.rows.find((r) => r.key === key);
  if (target === undefined) throw new Error(`No grid row ${key}`);
  if (action === 'edit' && (edit === undefined || Object.keys(edit).length === 0)) {
    throw new Error('An edit needs at least one changed value');
  }
  const status: GridRowStatus =
    action === 'confirm' ? 'confirmed' : action === 'edit' ? 'edited' : 'skipped';
  const listConfirmed = grid.listConfirmed || action !== 'skip';
  const rows = grid.rows.map((row) => {
    const changed =
      row.key === key
        ? {
            ...row,
            status,
            ...(action === 'edit' && edit !== undefined ? { edit } : {}),
            cells:
              action === 'edit' && edit !== undefined
                ? row.cells.map((c) =>
                    edit[c.column] === undefined ? c : { ...c, value: edit[c.column] ?? null },
                  )
                : row.cells,
          }
        : row;
    return { ...changed, confidence: displayConfidence(changed.source, listConfirmed) };
  });
  return { ...grid, rows, listConfirmed };
}

/** What a workspace already knows: the identifiers a row is matched against. */
export interface WorkspaceIdentifiers {
  /** CNRs of the workspace's proceedings. */
  cnrs: ReadonlySet<string>;
  /** Match keys (`TYPE/NUMBER/YEAR`) of the workspace's proceedings. */
  matchKeys: ReadonlySet<string>;
  /** Party aliases (upper-case, see `partyAliases`). */
  partyAliases: ReadonlySet<string>;
}

export interface RowMatch {
  by: 'cnr' | 'case_number' | 'party_alias';
  /** 0..1; a case number or CNR is 0.95, a party alias 0.6. */
  score: number;
}

/** How a row matches the workspace, or null. District lists carry no advocate: none is needed. */
export function matchRow(
  row: Pick<A0Row, 'cnr' | 'caseRef' | 'parties'>,
  ids: WorkspaceIdentifiers,
): RowMatch | null {
  if (row.cnr !== undefined && ids.cnrs.has(row.cnr)) return { by: 'cnr', score: 0.95 };
  const key = row.caseRef?.matchKey;
  if (key != null && ids.matchKeys.has(key)) return { by: 'case_number', score: 0.95 };
  if (row.parties?.aliases.some((a) => ids.partyAliases.has(a)) === true) {
    return { by: 'party_alias', score: 0.6 };
  }
  return null;
}

export interface MatchedRows {
  matched: { row: A0Row; match: RowMatch }[];
  /** Returned to the caller for discard without storage (docs/product/09 §8.4). */
  discard: A0Row[];
}

/** Rows are proposed only when they match a workspace identifier; the rest are for discard. */
export function matchRows(rows: readonly A0Row[], ids: WorkspaceIdentifiers): MatchedRows {
  const matched: MatchedRows['matched'] = [];
  const discard: A0Row[] = [];
  for (const row of rows) {
    const match = matchRow(row, ids);
    if (match === null) discard.push(row);
    else matched.push({ row, match });
  }
  return { matched, discard };
}

/** The row as the person left it: edited values replace the document's. */
export function effectiveRow(row: GridRow): A0Row {
  const edit = row.edit;
  if (edit === undefined) return row.source;
  return {
    ...row.source,
    ...(edit.parties === undefined ? {} : { parties: partyAliases(edit.parties) }),
    ...(edit.courtHall === undefined ? {} : { hall: edit.courtHall }),
    ...(edit.stageText === undefined ? {} : { stageText: edit.stageText }),
  };
}
