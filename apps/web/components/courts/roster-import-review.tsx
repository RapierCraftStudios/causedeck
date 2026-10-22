'use client';

// The roster import review (#436, part 3 of #391). Owners and advocates upload the court's
// sitting-arrangements PDF (`/api/uploads`), the part 1 preview action parses it, and the lawyer
// reviews every parsed hall in an editable grid before one "Confirm roster" writes it (nothing is
// saved before). Parsing is heuristic and always confirmed by the lawyer; no AI.
//
// Grid: `role="grid"` with a roving tab stop. Arrow keys, Home and End move between cells; Enter
// (or F2) edits the focused cell, Enter commits and Escape cancels; every committed edit is read
// out by a polite live region. Columns: Hall, Judges (semicolon separated), Portfolio (muted ink),
// Case types and Years (the optional portfolio rule, shown as chips), Confidence and Remove. A row
// read with confidence below 0.6 carries a warning icon and "Check this row" (never colour alone);
// it warns, it does not block. A blank hall or a row with no judge blocks confirm, as the confirm
// schema needs both. Rows fade and rise in over 200 ms ease-out (reduced motion: opacity only).
//
// Summary bar (sticky): the required effective-from date (prefilled when the PDF states it, else
// the parse-error note), hall count, rows-to-check count and "Confirm roster"; Cmd/Ctrl+Enter
// anywhere in the review confirms. A forum with an active roster (or a CONFLICT from the action)
// asks in a Dialog before superseding it. Benches are shown as the court publishes them: nothing
// here groups, counts or ranks by judge (PX-9, ME-6).
import { Alert } from '@causedeck/ui/alert';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Input } from '@causedeck/ui/input';
import { ErrorState } from '@causedeck/ui/patterns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import { Skeleton } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@causedeck/ui/table';
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import type { Result } from '../../lib/safe-action.ts';
import { uploadFile, type UploadFailure, type UploadResult } from '../../lib/upload-client.ts';

import { rostersHref } from './roster-forum-picker.tsx';
import { formatDay, presenceClass, useOnline, usePresence } from './roster-table.tsx';

/** Rows read below this confidence carry a warning (they still confirm). */
export const LOW_CONFIDENCE = 0.6;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

/** The preview action's result (`previewRosterImportAction`, rosters/actions.ts). */
export interface RosterImportPreview {
  forumCode: string;
  effectiveFrom: { date: string; anchor: unknown } | null;
  effectiveFromRequired: boolean;
  candidates: {
    hallNo: string;
    judges: string[];
    portfolioText: string;
    confidence: number;
    anchor: unknown;
  }[];
}

/** The confirm action's result (`confirmRosterImportAction`). */
export interface ConfirmedRosterImport {
  rosterId: string;
  version: number;
  effectiveFrom: string;
  alertsCreated: number;
  detection: 'ok' | 'failed';
}

export interface ReviewedRule {
  caseTypes?: string[];
  yearFrom?: number;
  yearTo?: number;
}

/** One confirmed hall, as `ConfirmedRosterEntrySchema` takes it. */
export interface ReviewedEntry {
  hallNo: string;
  judges: string[];
  portfolioText: string;
  portfolioRule?: ReviewedRule;
}

export interface PreviewRosterInput {
  workspaceId: string;
  blobId: string;
  forumCode: string;
}

export interface ConfirmRosterInput {
  workspaceId: string;
  forumId: string;
  effectiveFrom: string;
  entries: ReviewedEntry[];
  supersedeCurrent?: boolean;
}

export interface RosterImportForum {
  id: string;
  code: string;
  court: string;
}

export interface RosterImportReviewProps {
  slug: string;
  workspaceId: string;
  forum: RosterImportForum;
  /** The forum has an active roster: confirming supersedes it, so a Dialog asks first. */
  hasActiveRoster: boolean;
  preview: (input: PreviewRosterInput) => Promise<Result<RosterImportPreview>>;
  confirm: (input: ConfirmRosterInput) => Promise<Result<ConfirmedRosterImport>>;
  /** Defaults to `/api/uploads` (lib/upload-client.ts); stories and tests pass their own. */
  upload?: (workspaceId: string, file: File) => Promise<UploadResult>;
  /** Start in review with this preview (stories); `blobId` is unused once parsed. */
  initialPreview?: RosterImportPreview;
}

/** A hall in the review grid. */
export interface ReviewRow {
  key: string;
  hallNo: string;
  judges: string[];
  portfolioText: string;
  caseTypes: string[];
  yearFrom?: number;
  yearTo?: number;
  confidence: number;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (exported for the tests).

/** Judges typed as one cell: separated by semicolons or new lines. */
export function parseJudges(text: string): string[] {
  return text
    .split(/[;\n]/)
    .map((name) => name.trim().replace(/\s+/g, ' '))
    .filter((name) => name !== '');
}

/** Case types as the confirm schema wants them: upper-case, no dots or spaces, no repeats. */
export function parseCaseTypes(text: string): string[] {
  const codes = text
    .split(/[,;\n]/)
    .map((code) => code.toUpperCase().replace(/[.\s]/g, ''))
    .filter((code) => code !== '');
  return [...new Set(codes)];
}

/**
 * A year or a range (`2020`, `2020-2024`, `2020-`, `-2024`); `{}` for blank text and `null` when
 * it is not one (outside 1900 to 2200, or the end before the start).
 */
export function parseYearRange(text: string): { yearFrom?: number; yearTo?: number } | null {
  const value = text.trim();
  if (value === '') return {};
  const single = /^(\d{4})$/.exec(value);
  const range = /^(\d{4})?\s*(?:-|–|to)\s*(\d{4})?$/i.exec(value);
  let from: number | undefined;
  let to: number | undefined;
  if (single) {
    from = Number(single[1]);
    to = from;
  } else if (range && (range[1] !== undefined || range[2] !== undefined)) {
    from = range[1] === undefined ? undefined : Number(range[1]);
    to = range[2] === undefined ? undefined : Number(range[2]);
  } else {
    return null;
  }
  const inRange = (year: number | undefined) =>
    year === undefined || (year >= MIN_YEAR && year <= MAX_YEAR);
  if (!inRange(from) || !inRange(to)) return null;
  if (from !== undefined && to !== undefined && from > to) return null;
  return {
    ...(from === undefined ? {} : { yearFrom: from }),
    ...(to === undefined ? {} : { yearTo: to }),
  };
}

/** The years of a row as the editor shows them. */
export function formatYearRange(row: Pick<ReviewRow, 'yearFrom' | 'yearTo'>): string {
  const { yearFrom, yearTo } = row;
  if (yearFrom !== undefined && yearTo !== undefined) {
    return yearFrom === yearTo ? String(yearFrom) : `${String(yearFrom)}-${String(yearTo)}`;
  }
  if (yearFrom !== undefined) return `${String(yearFrom)}-`;
  if (yearTo !== undefined) return `-${String(yearTo)}`;
  return '';
}

export function isLowConfidence(confidence: number): boolean {
  return confidence < LOW_CONFIDENCE;
}

/** What blocks a row from confirming: a blank hall, or no judge. */
export function rowProblems(row: ReviewRow): ('hall' | 'judges')[] {
  const problems: ('hall' | 'judges')[] = [];
  if (row.hallNo.trim() === '') problems.push('hall');
  if (row.judges.length === 0) problems.push('judges');
  return problems;
}

/** The preview's candidates as review rows (no rule yet: the lawyer adds one). */
export function rowsFromPreview(preview: RosterImportPreview): ReviewRow[] {
  return preview.candidates.map((candidate, index) => ({
    key: `row-${String(index)}`,
    hallNo: candidate.hallNo,
    judges: candidate.judges,
    portfolioText: candidate.portfolioText,
    caseTypes: [],
    confidence: candidate.confidence,
  }));
}

/** The reviewed rows as confirm entries; a rule only when the lawyer gave one. */
export function toConfirmedEntries(rows: readonly ReviewRow[]): ReviewedEntry[] {
  return rows.map((row) => {
    const rule: ReviewedRule = {
      ...(row.caseTypes.length > 0 ? { caseTypes: row.caseTypes } : {}),
      ...(row.yearFrom === undefined ? {} : { yearFrom: row.yearFrom }),
      ...(row.yearTo === undefined ? {} : { yearTo: row.yearTo }),
    };
    return {
      hallNo: row.hallNo.trim(),
      judges: row.judges,
      portfolioText: row.portfolioText.trim(),
      ...(Object.keys(rule).length > 0 ? { portfolioRule: rule } : {}),
    };
  });
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

// ---------------------------------------------------------------------------------------------
// Grid columns.

const COLUMNS = ['hall', 'judges', 'portfolio', 'caseTypes', 'years', 'confidence', 'remove'];
type Column = (typeof COLUMNS)[number];
const EDITABLE: ReadonlySet<Column> = new Set([
  'hall',
  'judges',
  'portfolio',
  'caseTypes',
  'years',
]);
const REMOVE_COLUMN = COLUMNS.indexOf('remove');

function cellText(row: ReviewRow, column: Column): string {
  switch (column) {
    case 'hall':
      return row.hallNo;
    case 'judges':
      return row.judges.join('; ');
    case 'portfolio':
      return row.portfolioText;
    case 'caseTypes':
      return row.caseTypes.join(', ');
    case 'years':
      return formatYearRange(row);
    default:
      return '';
  }
}

/** `row` with `column` set from `text`; `null` when the text is not valid for the column. */
function withCell(row: ReviewRow, column: Column, text: string): ReviewRow | null {
  switch (column) {
    case 'hall':
      return { ...row, hallNo: text.trim() };
    case 'judges':
      return { ...row, judges: parseJudges(text) };
    case 'portfolio':
      return { ...row, portfolioText: text.trim() };
    case 'caseTypes':
      return { ...row, caseTypes: parseCaseTypes(text) };
    case 'years': {
      const years = parseYearRange(text);
      if (years === null) return null;
      const rest = { ...row };
      delete rest.yearFrom;
      delete rest.yearTo;
      return { ...rest, ...years };
    }
    default:
      return row;
  }
}

type Phase =
  | { kind: 'upload'; error?: string }
  | { kind: 'reading' }
  | { kind: 'unreadable'; reason: 'unreadable' | 'noRows' }
  | { kind: 'review' };

interface Position {
  row: number;
  col: number;
}

// ---------------------------------------------------------------------------------------------

export function RosterImportReview({
  slug,
  workspaceId,
  forum,
  hasActiveRoster,
  preview,
  confirm,
  upload = uploadFile,
  initialPreview,
}: RosterImportReviewProps) {
  const t = useTranslations('courtsRosters.import');
  const tRosters = useTranslations('courtsRosters');
  const locale = useLocale();
  const router = useRouter();
  const online = useOnline();
  const id = useId();

  const [phase, setPhase] = useState<Phase>(
    initialPreview === undefined ? { kind: 'upload' } : { kind: 'review' },
  );
  const [parsed, setParsed] = useState<RosterImportPreview | null>(initialPreview ?? null);
  const [rows, setRows] = useState<ReviewRow[]>(() =>
    initialPreview === undefined ? [] : rowsFromPreview(initialPreview),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(initialPreview?.effectiveFrom?.date ?? '');
  const [showProblems, setShowProblems] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [supersedeOpen, setSupersedeOpen] = useState(false);
  const [active, setActive] = useState<Position>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<{ position: Position; draft: string } | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const gridRef = useRef<HTMLTableElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  /** Move focus to the active cell after the next render (keyboard moves, edit end). */
  const focusPending = useRef(false);
  /** The edit in progress; cleared before a cancel so the editor's blur does not commit it. */
  const editingRef = useRef<Position | null>(null);

  const presence = usePresence(rows, (row) => row.key);
  const lowCount = rows.filter((row) => isLowConfidence(row.confidence)).length;
  const dateMissing = !DAY.test(effectiveFrom);

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    const grid = gridRef.current;
    if (grid === null) return;
    const target = grid.querySelector<HTMLElement>(
      `[data-cell="${String(active.row)}-${String(active.col)}"]`,
    );
    target?.focus();
  });

  const label = (column: Column): string => {
    switch (column) {
      case 'hall':
        return t('grid.hall');
      case 'judges':
        return t('grid.judges');
      case 'portfolio':
        return t('grid.portfolio');
      case 'caseTypes':
        return t('grid.caseTypes');
      case 'years':
        return t('grid.years');
      case 'confidence':
        return t('grid.confidence');
      default:
        return t('grid.removeColumn');
    }
  };

  // ---- upload and preview ----

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (!isPdf(file)) {
      setPhase({ kind: 'upload', error: t('upload.notPdf') });
      return;
    }
    setPhase({ kind: 'reading' });
    const uploaded = await upload(workspaceId, file);
    if (!uploaded.ok) {
      setPhase({ kind: 'upload', error: uploadMessage(uploaded.error) });
      return;
    }
    let result: Result<RosterImportPreview>;
    try {
      result = await preview({ workspaceId, blobId: uploaded.blobId, forumCode: forum.code });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    if (!result.ok) {
      if (result.error.code === 'VALIDATION') {
        setPhase({ kind: 'unreadable', reason: 'unreadable' });
      } else {
        setPhase({ kind: 'upload', error: t('upload.failed') });
      }
      return;
    }
    if (result.data.candidates.length === 0) {
      setPhase({ kind: 'unreadable', reason: 'noRows' });
      return;
    }
    setParsed(result.data);
    setRows(rowsFromPreview(result.data));
    setEffectiveFrom(result.data.effectiveFrom?.date ?? '');
    setShowProblems(false);
    setFormError(null);
    setActive({ row: 0, col: 0 });
    setPhase({ kind: 'review' });
  }

  function uploadMessage(error: UploadFailure): string {
    if (error === 'too_large') return t('upload.tooLarge');
    if (error === 'invalid') return t('upload.notPdf');
    return t('upload.failed');
  }

  function chooseAnother() {
    setPhase({ kind: 'upload' });
    setParsed(null);
    setRows([]);
  }

  // ---- editing ----

  function startEdit(position: Position) {
    const row = rows[position.row];
    const column = COLUMNS[position.col];
    if (row === undefined || column === undefined || !EDITABLE.has(column)) return;
    editingRef.current = position;
    setCellError(null);
    setEditing({ position, draft: cellText(row, column) });
  }

  /** Commit the edit; the new rows, or `null` when the text was not valid (the editor stays). */
  function commitEdit(refocus: boolean): ReviewRow[] | null {
    if (editing === null || editingRef.current === null) return rows;
    const { position, draft } = editing;
    const row = rows[position.row];
    const column = COLUMNS[position.col];
    if (row === undefined || column === undefined) return rows;
    const next = withCell(row, column, draft);
    if (next === null) {
      setCellError(t('grid.invalidYears'));
      return null;
    }
    editingRef.current = null;
    setEditing(null);
    setCellError(null);
    const updated = rows.map((r, index) => (index === position.row ? next : r));
    setRows(updated);
    const before = cellText(row, column);
    const after = cellText(next, column);
    if (before !== after) {
      const hall = next.hallNo === '' ? row.hallNo : next.hallNo;
      setAnnouncement(
        after === ''
          ? t('grid.cleared', { column: label(column), hall })
          : t('grid.announce', { column: label(column), hall, value: after }),
      );
    }
    if (refocus) focusPending.current = true;
    return updated;
  }

  function cancelEdit() {
    editingRef.current = null;
    setEditing(null);
    setCellError(null);
    focusPending.current = true;
  }

  function removeRow(index: number) {
    const row = rows[index];
    if (row === undefined) return;
    const updated = rows.filter((_, i) => i !== index);
    setRows(updated);
    setAnnouncement(t('grid.removed', { hall: row.hallNo }));
    setActive({ row: Math.max(0, Math.min(index, updated.length - 1)), col: REMOVE_COLUMN });
    focusPending.current = updated.length > 0;
  }

  function move(position: Position) {
    setActive(position);
    focusPending.current = true;
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (editing !== null) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return;
    const last = { row: rows.length - 1, col: COLUMNS.length - 1 };
    const { row, col } = active;
    switch (event.key) {
      case 'ArrowDown':
        move({ row: Math.min(row + 1, last.row), col });
        break;
      case 'ArrowUp':
        move({ row: Math.max(row - 1, 0), col });
        break;
      case 'ArrowRight':
        move({ row, col: Math.min(col + 1, last.col) });
        break;
      case 'ArrowLeft':
        move({ row, col: Math.max(col - 1, 0) });
        break;
      case 'Home':
        move({ row: event.ctrlKey ? 0 : row, col: 0 });
        break;
      case 'End':
        move({ row: event.ctrlKey ? last.row : row, col: last.col });
        break;
      case 'Enter':
      case 'F2':
        // The Remove cell holds a button: Enter presses it.
        if (col === REMOVE_COLUMN) return;
        startEdit(active);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      const updated = commitEdit(true);
      if (updated !== null && (event.metaKey || event.ctrlKey)) requestConfirm(updated);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }

  // ---- confirm ----

  function requestConfirm(current: readonly ReviewRow[] = rows, supersede = false) {
    if (pending) return;
    setFormError(null);
    if (dateMissing) {
      setShowProblems(true);
      setFormError(t('effectiveFrom.required'));
      dateRef.current?.focus();
      return;
    }
    if (current.length === 0) {
      setFormError(t('validation.rows'));
      return;
    }
    const firstBad = current.findIndex((row) => rowProblems(row).length > 0);
    if (firstBad !== -1) {
      setShowProblems(true);
      setFormError(t('validation.fix'));
      const problem = rowProblems(current[firstBad] as ReviewRow)[0];
      move({ row: firstBad, col: problem === 'hall' ? 0 : 1 });
      return;
    }
    if (hasActiveRoster && !supersede) {
      setSupersedeOpen(true);
      return;
    }
    void submit(current, supersede);
  }

  async function submit(current: readonly ReviewRow[], supersede: boolean) {
    setPending(true);
    let result: Result<ConfirmedRosterImport>;
    try {
      result = await confirm({
        workspaceId,
        forumId: forum.id,
        effectiveFrom,
        entries: toConfirmedEntries(current),
        ...(supersede ? { supersedeCurrent: true } : {}),
      });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      if (result.error.code === 'CONFLICT' && !supersede) {
        setSupersedeOpen(true);
        return;
      }
      setFormError(t('failed'));
      return;
    }
    setSupersedeOpen(false);
    const { data } = result;
    toast(t('done', { date: formatDay(data.effectiveFrom, locale) }), {
      description:
        data.detection === 'failed'
          ? t('detectionFailed')
          : t('alerts', { count: data.alertsCreated }),
    });
    router.push(rostersHref(slug, forum.code));
  }

  function onReviewKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && editing === null) {
      event.preventDefault();
      requestConfirm();
    }
  }

  // ---- render ----

  const heading = (
    <p data-roster-import-forum={forum.code} className="text-ink-muted text-sm">
      {t('forum', { court: forum.court })}
    </p>
  );

  if (phase.kind === 'upload' || phase.kind === 'reading') {
    const reading = phase.kind === 'reading';
    const inputId = `${id}-file`;
    const hintId = `${id}-file-hint`;
    return (
      <section data-roster-import="upload" className="flex flex-col gap-4">
        {heading}
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            {t('upload.label')}
          </label>
          <input
            id={inputId}
            type="file"
            accept="application/pdf,.pdf"
            aria-describedby={hintId}
            disabled={!online || reading}
            onChange={(event) => {
              void onFile(event);
            }}
            className="file:border-line-control file:bg-surface text-sm file:me-3 file:rounded-md file:border file:px-3 file:py-1.5 disabled:opacity-50"
          />
          <p id={hintId} className="text-ink-muted text-xs">
            {online ? t('upload.hint') : tRosters('importOffline')}
          </p>
        </div>
        {phase.kind === 'upload' && phase.error !== undefined ? (
          <Alert tone="danger" role="alert" data-roster-import-error="">
            {phase.error}
          </Alert>
        ) : null}
        {reading ? (
          <div data-pattern-state="loading" aria-busy="true" className="flex flex-col gap-2">
            <p role="status" className="text-ink-muted text-sm">
              {t('upload.uploading')}
            </p>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  if (phase.kind === 'unreadable') {
    return (
      <section data-roster-import="unreadable" className="flex flex-col gap-4">
        {heading}
        <ErrorState
          data-pattern-state="error"
          title={phase.reason === 'noRows' ? t('noRows') : t('unreadable.title')}
          onRetry={chooseAnother}
          labels={{ retry: t('unreadable.retry') }}
        />
      </section>
    );
  }

  const dateId = `${id}-date`;
  const dateNoteId = `${id}-date-note`;
  const hintId = `${id}-grid-hint`;
  const editingAt = editing?.position;

  return (
    <section
      data-roster-import="review"
      className="flex flex-col gap-4"
      onKeyDown={onReviewKeyDown}
    >
      {heading}
      {parsed?.effectiveFromRequired ? (
        <Alert tone="warning" data-roster-import-parse-error="">
          {t('parseError')}
        </Alert>
      ) : null}

      <div
        role="group"
        aria-label={t('summary.label')}
        data-roster-import-summary=""
        className="bg-surface border-line sticky top-0 z-10 flex flex-wrap items-end gap-4 border-b py-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={dateId} className="text-sm font-medium">
            {t('effectiveFrom.label')}
          </label>
          <Input
            ref={dateRef}
            id={dateId}
            type="date"
            required
            aria-required="true"
            aria-invalid={showProblems && dateMissing ? true : undefined}
            aria-describedby={dateNoteId}
            value={effectiveFrom}
            onChange={(event) => {
              setEffectiveFrom(event.target.value);
            }}
            className="font-serif"
          />
          <p
            id={dateNoteId}
            className={
              showProblems && dateMissing ? 'text-danger text-xs' : 'text-ink-muted text-xs'
            }
          >
            {showProblems && dateMissing
              ? t('effectiveFrom.required')
              : parsed?.effectiveFrom
                ? t('effectiveFrom.fromPdf')
                : t('effectiveFrom.required')}
          </p>
        </div>
        <p data-roster-import-rows="" className="text-sm">
          {t('summary.rows', { count: rows.length })}
        </p>
        <p
          data-roster-import-low={lowCount}
          className={
            lowCount > 0 ? 'text-warning flex items-center gap-1 text-sm' : 'text-ink-muted text-sm'
          }
        >
          {lowCount > 0 ? <AlertTriangle aria-hidden className="size-4" /> : null}
          {t('summary.lowConfidence', { count: lowCount })}
        </p>
        <Button
          type="button"
          className="ms-auto"
          disabled={pending || !online}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          data-roster-import-confirm=""
          onClick={() => {
            requestConfirm();
          }}
        >
          {pending ? t('confirming') : t('confirm')}
        </Button>
      </div>

      {formError === null ? null : (
        <Alert tone="danger" role="alert" data-roster-import-error="">
          {formError}
        </Alert>
      )}

      <p id={hintId} className="text-ink-muted text-xs">
        {t('grid.hint')}
      </p>
      <Table
        ref={gridRef}
        role="grid"
        aria-label={t('grid.label')}
        aria-describedby={hintId}
        aria-rowcount={rows.length + 1}
        aria-colcount={COLUMNS.length}
        data-roster-import-grid=""
        onKeyDown={onGridKeyDown}
      >
        <TableHeader>
          <TableRow role="row" aria-rowindex={1}>
            {COLUMNS.map((column, col) => (
              <TableHead key={column} role="columnheader" aria-colindex={col + 1}>
                {column === 'remove' ? (
                  <span className="sr-only">{label(column)}</span>
                ) : (
                  label(column)
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {presence.map((entry) => {
            const row = entry.item;
            const index = entry.leaving ? -1 : rows.indexOf(row);
            const low = isLowConfidence(row.confidence);
            const problems = showProblems && index !== -1 ? rowProblems(row) : [];
            return (
              <TableRow
                key={row.key}
                role="row"
                aria-rowindex={index === -1 ? undefined : index + 2}
                aria-hidden={entry.leaving ? true : undefined}
                data-roster-import-row={row.hallNo}
                data-low-confidence={low ? '' : undefined}
                aria-invalid={problems.length > 0 ? true : undefined}
                className={[low ? 'bg-warning-soft' : '', presenceClass(entry) ?? ''].join(' ')}
              >
                {COLUMNS.map((column, col) => {
                  const position = { row: index, col };
                  const isActive = index === active.row && col === active.col;
                  const isEditing =
                    editingAt !== undefined &&
                    editingAt.row === index &&
                    editingAt.col === col &&
                    editing !== null;
                  const cellKey = index === -1 ? undefined : `${String(index)}-${String(col)}`;
                  const invalid =
                    (column === 'hall' && problems.includes('hall')) ||
                    (column === 'judges' && problems.includes('judges'));

                  if (column === 'remove') {
                    return (
                      <TableCell key={column} role="gridcell" aria-colindex={col + 1}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-cell={cellKey}
                          tabIndex={isActive ? 0 : -1}
                          aria-label={t('grid.remove', { hall: row.hallNo })}
                          onFocus={() => {
                            if (index !== -1) setActive(position);
                          }}
                          onClick={() => {
                            removeRow(index);
                          }}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </TableCell>
                    );
                  }

                  const editable = EDITABLE.has(column);
                  return (
                    <TableCell
                      key={column}
                      role="gridcell"
                      aria-colindex={col + 1}
                      aria-readonly={editable ? undefined : true}
                      aria-invalid={invalid ? true : undefined}
                      data-cell={isEditing ? undefined : cellKey}
                      data-column={column}
                      tabIndex={isEditing ? undefined : isActive ? 0 : -1}
                      onFocus={(event) => {
                        if (event.target === event.currentTarget && index !== -1) {
                          setActive(position);
                        }
                      }}
                      onDoubleClick={() => {
                        if (editable && index !== -1) {
                          setActive(position);
                          startEdit(position);
                        }
                      }}
                      className={[
                        'focus-visible:outline-ring py-2 align-top outline-offset-[-2px] focus-visible:outline-2',
                        column === 'portfolio' ? 'text-ink-muted' : '',
                        invalid ? 'outline-danger outline-1' : '',
                      ].join(' ')}
                    >
                      {isEditing ? (
                        <div className="flex flex-col gap-1">
                          <Input
                            autoFocus
                            aria-label={t('grid.edit', { column: label(column), hall: row.hallNo })}
                            aria-invalid={cellError === null ? undefined : true}
                            value={editing.draft}
                            onChange={(event) => {
                              setEditing({ position: editing.position, draft: event.target.value });
                            }}
                            onKeyDown={onEditorKeyDown}
                            onBlur={() => {
                              if (editingRef.current !== null) commitEdit(false);
                            }}
                          />
                          {cellError === null ? (
                            <EditHint column={column} />
                          ) : (
                            <p role="alert" className="text-danger text-xs">
                              {cellError}
                            </p>
                          )}
                        </div>
                      ) : (
                        <CellView row={row} column={column} problems={problems} />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p role="status" aria-live="polite" data-roster-import-announce="" className="sr-only">
        {announcement}
      </p>

      <Dialog
        open={supersedeOpen}
        onOpenChange={(open) => {
          if (!pending) setSupersedeOpen(open);
        }}
      >
        <DialogContent data-slot="roster-supersede-dialog">
          <DialogHeader>
            <DialogTitle>{t('supersede.title')}</DialogTitle>
            <DialogDescription>
              {t('supersede.body', {
                date: DAY.test(effectiveFrom) ? formatDay(effectiveFrom, locale) : effectiveFrom,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setSupersedeOpen(false);
              }}
            >
              {t('supersede.cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending}
              data-roster-supersede-confirm=""
              onClick={() => {
                void submit(rows, true);
              }}
            >
              {pending ? t('confirming') : t('supersede.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function EditHint({ column }: { column: Column }) {
  const t = useTranslations('courtsRosters.import.grid');
  if (column === 'judges') return <p className="text-ink-muted text-xs">{t('judgesHint')}</p>;
  if (column === 'caseTypes') {
    return <p className="text-ink-muted text-xs">{t('caseTypesHint')}</p>;
  }
  if (column === 'years') return <p className="text-ink-muted text-xs">{t('yearsHint')}</p>;
  return null;
}

function CellView({
  row,
  column,
  problems,
}: {
  row: ReviewRow;
  column: Column;
  problems: readonly ('hall' | 'judges')[];
}) {
  const t = useTranslations('courtsRosters.import');
  const none = <span className="text-ink-muted">{t('grid.none')}</span>;
  switch (column) {
    case 'hall':
      return problems.includes('hall') ? (
        <span className="text-danger text-xs">{t('validation.hall')}</span>
      ) : (
        <span className="font-medium">{row.hallNo}</span>
      );
    case 'judges':
      if (problems.includes('judges')) {
        return <span className="text-danger text-xs">{t('validation.judges')}</span>;
      }
      return row.judges.length === 0 ? (
        none
      ) : (
        <ul className="flex flex-col">
          {row.judges.map((judge) => (
            <li key={judge}>{judge}</li>
          ))}
        </ul>
      );
    case 'portfolio':
      return row.portfolioText === '' ? none : <span>{row.portfolioText}</span>;
    case 'caseTypes':
      return row.caseTypes.length === 0 ? (
        none
      ) : (
        <span className="flex flex-wrap gap-1">
          {row.caseTypes.map((code) => (
            <Badge key={code} tone="accent" data-rule-chip="caseType">
              {code}
            </Badge>
          ))}
        </span>
      );
    case 'years': {
      const { yearFrom, yearTo } = row;
      if (yearFrom === undefined && yearTo === undefined) return none;
      let text: string;
      if (yearFrom !== undefined && yearTo !== undefined) {
        text =
          yearFrom === yearTo
            ? String(yearFrom)
            : t('grid.yearRange', { from: String(yearFrom), to: String(yearTo) });
      } else if (yearFrom !== undefined) {
        text = t('grid.yearFrom', { year: String(yearFrom) });
      } else {
        text = t('grid.yearTo', { year: String(yearTo) });
      }
      return (
        <Badge tone="accent" data-rule-chip="years">
          {text}
        </Badge>
      );
    }
    case 'confidence':
      return <ConfidenceView confidence={row.confidence} />;
    default:
      return null;
  }
}

function ConfidenceView({ confidence }: { confidence: number }) {
  const t = useTranslations('courtsRosters.import.confidence');
  const locale = useLocale();
  const percent = new Intl.NumberFormat(locale, { style: 'percent' }).format(confidence);
  if (isLowConfidence(confidence)) {
    return (
      <span data-confidence="low" className="text-warning flex items-center gap-1 text-xs">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        <span>
          {t('low')} ({percent})
        </span>
      </span>
    );
  }
  return (
    <span data-confidence="ok" className="text-ink-muted flex items-center gap-1 text-xs">
      <CheckCircle2 aria-hidden className="size-4 shrink-0" />
      <span>
        {t('ok')} ({percent})
      </span>
    </span>
  );
}

export interface RosterImportForumSelectProps {
  slug: string;
  forums: readonly { code: string; court: string; seat: string | null }[];
}

/** No forum chosen yet: pick the court the roster belongs to (`?forum=<code>`). */
export function RosterImportForumSelect({ slug, forums }: RosterImportForumSelectProps) {
  const t = useTranslations('courtsRosters.import.chooseForum');
  const router = useRouter();
  return (
    <section data-roster-import="choose-forum" className="flex max-w-md flex-col gap-2">
      <h2 className="text-base font-medium">{t('title')}</h2>
      <p className="text-ink-muted text-sm">{t('hint')}</p>
      <Select
        onValueChange={(code) => {
          router.push(
            `/w/${encodeURIComponent(slug)}/courts/rosters/import?forum=${encodeURIComponent(code)}`,
          );
        }}
      >
        <SelectTrigger aria-label={t('label')} data-roster-import-forum-select="">
          <SelectValue placeholder={t('placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {forums.map((forum) => (
            <SelectItem key={forum.code} value={forum.code}>
              {forum.court}
              {forum.seat === null ? '' : `, ${forum.seat}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}
