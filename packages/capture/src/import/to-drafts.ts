// Sheet rows -> proposals (#504). Each row with a case number (or CNR) becomes a `new_proceeding`
// draft the import plan groups into the confirm grid. Nothing is applied by the draft itself: it has
// a score and no exact match. Drafts are deterministic (same sheet, same drafts), keyed by `matchKey`
// so the plan merges repeats, and rows repeating a key and date inside the sheet are dropped.
import { createHash } from 'node:crypto';

import type { ProposalDraft } from '@causedeck/validators/proposal-draft';

import type { ColumnIndices } from './mapping.ts';

export const SHEET_INPUT = 'sheet';
export const SHEET_PATTERN_KEY = 'import:sheet_row';
const SHEET_CONFIDENCE = 0.9;
const CNR = /^[A-Z0-9]{16}$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Excel serials for 1990-01-01 .. 2099-12-31: other plain numbers are not dates. */
const SERIAL_MIN = 32874;
const SERIAL_MAX = 73415;

export interface SheetRowError {
  /** 1-based line of the row in the sheet (the header is line 1). */
  line: number;
  message: string;
}

export interface SheetDrafts {
  drafts: ProposalDraft[];
  errors: SheetRowError[];
  /** Rows dropped as a repeat of an earlier row (same case and date). */
  duplicates: number;
}

function isoDay(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` from ISO, day-first `dd/mm/yyyy` (also `-` and `.`), `dd-Mon-yyyy` or an Excel serial. */
export function parseSheetDate(raw: string): string | null {
  const text = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (m) return isoDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return isoDay(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})[\s/.,-]+(\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS.indexOf((m[2] ?? '').slice(0, 3).toLowerCase()) + 1;
    return month === 0 ? null : isoDay(Number(m[3]), month, Number(m[1]));
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial >= SERIAL_MIN && serial <= SERIAL_MAX) {
      return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
    }
  }
  return null;
}

interface CaseRef {
  type: string | null;
  number: string;
  year: number | null;
}

/** `WP 123/2024`, `123 of 2024`, `Crl.A. No. 45/2023`, or a bare `123`. */
export function parseCaseNumber(raw: string): CaseRef | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  const full =
    /^(?:([A-Za-z][A-Za-z.()\s&-]*?)[\s.:-]*(?:no\.?\s*)?)?(\d+[A-Za-z]?)\s*(?:\/|of|-)\s*(\d{4})$/i.exec(
      text,
    );
  if (full) {
    const type = (full[1] ?? '').replace(/[\s.:-]+$/, '').trim();
    return { type: type === '' ? null : type, number: full[2] ?? '', year: Number(full[3]) };
  }
  const bare = /^(?:([A-Za-z][A-Za-z.()\s&-]*?)[\s.:-]*(?:no\.?\s*)?)?(\d+[A-Za-z]?)$/i.exec(text);
  if (bare) {
    const type = (bare[1] ?? '').replace(/[\s.:-]+$/, '').trim();
    return { type: type === '' ? null : type, number: bare[2] ?? '', year: null };
  }
  return null;
}

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();
const key = (value: string | null): string =>
  (value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

/**
 * Drafts of the data `rows` (header excluded) under `indices`. Row problems are reported, not
 * thrown: an unreadable date still imports the case, without a date.
 */
export function rowsToDrafts(
  rows: readonly (readonly string[])[],
  indices: ColumnIndices,
): SheetDrafts {
  const cell = (row: readonly string[], field: keyof ColumnIndices): string => {
    const index = indices[field];
    return index === undefined ? '' : squash(row[index] ?? '');
  };
  const drafts: ProposalDraft[] = [];
  const errors: SheetRowError[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  rows.forEach((row, at) => {
    const line = at + 2;
    if (row.every((value) => value.trim() === '')) return;
    const cnrRaw = cell(row, 'cnr').toUpperCase().replace(/[\s-]/g, '');
    const cnr = CNR.test(cnrRaw) ? cnrRaw : null;
    const ref = parseCaseNumber(cell(row, 'caseNumber'));
    if (cnr === null && ref === null) {
      errors.push({ line, message: 'No case number or CNR' });
      return;
    }
    const court = cell(row, 'court');
    const type = cell(row, 'caseType') || ref?.type || null;
    const dateRaw = cell(row, 'nextDate');
    const nextDate = dateRaw === '' ? null : parseSheetDate(dateRaw);
    if (dateRaw !== '' && nextDate === null) errors.push({ line, message: 'Unreadable date' });
    const matchKey =
      cnr !== null
        ? `cnr:${cnr}`
        : `sheet:${key(court)}|${key(type)}|${key(ref?.number ?? null)}|${String(ref?.year ?? '')}`;
    const dedupe = `${matchKey}|${nextDate ?? ''}`;
    if (seen.has(dedupe)) {
      duplicates += 1;
      return;
    }
    seen.add(dedupe);
    const party = cell(row, 'party');
    const stage = cell(row, 'stage');
    drafts.push({
      kind: 'new_proceeding',
      source: {
        type: 'deterministic',
        input: SHEET_INPUT,
        ref: createHash('sha256').update(dedupe).digest('hex').slice(0, 32),
      },
      payload: {
        matchKey,
        ...(type === null ? {} : { caseTypeRaw: type }),
        ...(ref === null ? {} : { caseNumber: ref.number }),
        ...(ref?.year == null ? {} : { caseYear: ref.year }),
        ...(court === '' ? {} : { forumCode: court }),
        ...(cnr === null ? {} : { cnr }),
        ...(party === '' ? {} : { parties: party }),
        ...(stage === '' ? {} : { stageRaw: stage }),
        ...(nextDate === null ? {} : { nextDate }),
      },
      anchors: [],
      confidence: SHEET_CONFIDENCE,
      match: { score: SHEET_CONFIDENCE },
      patternKey: SHEET_PATTERN_KEY,
    });
  });
  return { drafts, errors, duplicates };
}
