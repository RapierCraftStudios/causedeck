// A0 corrections (#56): what a person changed in the confirmation grid, kept as data linked to the
// document. This change ships the model and the rules; persisting them (a `corrections` table) and
// the `workspace_settings.allow_eval_reuse` column are separate work, so storage sits behind a port.
// A correction improves the workspace's recognition memory (M7) only as a confirm-before-save
// memory proposal (#72), and reaches an eval set only when the workspace allows eval reuse (default
// false) and the person consented to that item. The text of a correction is customer content: it is
// never sent to a model and never used for training.
import type { ProposalDraft } from '@causedeck/validators/proposal-draft';

import type { ConfirmationGrid, GridColumn, GridRow } from './confirmation.ts';

export interface A0Correction {
  documentId: string;
  forumCode: string;
  /** The row's identity key (`identityKey`). */
  rowKey: string;
  column: GridColumn;
  /** What the document gave; null when the cell was empty. */
  before: string | null;
  /** What the person wrote. */
  after: string;
  page: number;
  /** The anchored quote the row was read from. */
  quote: string;
}

/** Where corrections are kept; implemented with the `corrections` table (follow-up). */
export interface CorrectionStore {
  save(corrections: readonly A0Correction[]): Promise<void>;
}

/** The corrections a grid holds: one per edited cell whose value differs from the document's. */
export function captureCorrections(documentId: string, grid: ConfirmationGrid): A0Correction[] {
  const out: A0Correction[] = [];
  for (const row of grid.rows) {
    if (row.status !== 'edited' || row.edit === undefined) continue;
    for (const [column, after] of Object.entries(row.edit) as [GridColumn, string][]) {
      const before = originalCell(row, column);
      if (after.trim() === '' || after === before) continue;
      out.push({
        documentId,
        forumCode: grid.forumCode,
        rowKey: row.key,
        column,
        before,
        after,
        page: row.source.anchor.page,
        quote: row.source.anchor.quote,
      });
    }
  }
  return out;
}

function originalCell(row: GridRow, column: GridColumn): string | null {
  switch (column) {
    case 'parties':
      return row.source.parties?.original ?? null;
    case 'courtHall':
      return row.source.hall ?? null;
    case 'stageText':
      return row.source.stageText ?? null;
    case 'date':
      return row.source.dates?.[0]?.iso ?? null;
    case 'caseNumber':
      return row.source.caseRef === undefined
        ? (row.source.cnr ?? null)
        : `${row.source.caseRef.caseTypeRaw} ${row.source.caseRef.caseNumber}/${String(row.source.caseRef.caseYear)}`;
  }
}

/**
 * A `memory_item` draft for recognition memory (M7): never saved unasked. The kind is
 * confirm-before-save (#72); `ambiguous` makes the engine show it as a card whatever the matrix says.
 */
export function correctionToMemoryDraft(
  correction: A0Correction,
  ctx: { captureId?: string | null; anchorId: string },
): ProposalDraft {
  return {
    kind: 'memory_item',
    ...(ctx.captureId == null ? {} : { captureId: ctx.captureId }),
    source: { type: 'deterministic', input: 'form', ref: correction.documentId },
    payload: {
      memoryType: 'recognition',
      scope: 'workspace',
      forumCode: correction.forumCode,
      column: correction.column,
      before: correction.before,
      after: correction.after,
    },
    anchors: [ctx.anchorId],
    patternKey: 'a0:correction',
    ambiguous: true,
  };
}

export interface EvalConsent {
  /** `workspace_settings.allow_eval_reuse` (default false). */
  allowEvalReuse: boolean;
  /** Per-item consent: the keys (`rowKey|column`) the person agreed to share. */
  itemConsent: ReadonlySet<string>;
}

export const consentKey = (c: Pick<A0Correction, 'rowKey' | 'column'>): string =>
  `${c.rowKey}|${c.column}`;

/** Corrections that may enter an eval set: the workspace allows it and the person consented per item. */
export function exportableForEval(
  corrections: readonly A0Correction[],
  consent: EvalConsent,
): A0Correction[] {
  if (!consent.allowEvalReuse) return [];
  return corrections.filter((c) => consent.itemConsent.has(consentKey(c)));
}
