// @vitest-environment jsdom
// Roster import review (#436): the parsed halls in an editable `role="grid"` (hall, judges,
// portfolio, case-type and year chips, confidence), arrows to move, Enter to edit and commit,
// Escape to cancel, each edit announced; rows below 0.6 confidence warned with an icon and text;
// a required effective-from date (the parse-error note when the PDF had none); one "Confirm roster"
// and Cmd/Ctrl+Enter; the supersede Dialog over an active roster or a CONFLICT; blank halls and
// rows without a judge blocked; the upload → preview flow, an unreadable PDF and offline.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Result } from '../../../lib/safe-action.ts';
import type { UploadResult } from '../../../lib/upload-client.ts';
import type { ConfirmedRosterImport, RosterImportPreview } from '../roster-import-review.tsx';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const { catalogs } = await import('../../../__tests__/helpers/intl.ts');
const { renderWithIntl, stubResizeObserver } = await import('../../shell/__tests__/helpers.tsx');
const { parseCaseTypes, parseJudges, parseYearRange, RosterImportReview, toConfirmedEntries } =
  await import('../roster-import-review.tsx');
type Preview = RosterImportPreview;
type Confirmed = Result<ConfirmedRosterImport>;

const en = catalogs.en.courtsRosters.import;
const WS = '00000000-0000-4000-8000-000000000001';
const FORUM = {
  id: '00000000-0000-4000-8000-0000000000f1',
  code: 'in.tn.madras-hc.principal.appellate',
  court: 'Madras High Court',
};
const BLOB = '00000000-0000-4000-8000-0000000000b1';
const anchor = { pageNo: 1, quote: 'COURT HALL No. 1' };

function previewOf(overrides: Partial<Preview> = {}): Preview {
  return {
    forumCode: FORUM.code,
    effectiveFrom: { date: '2026-10-05', anchor },
    effectiveFromRequired: false,
    candidates: [
      {
        hallNo: '1',
        judges: ['Justice A (fictional)'],
        portfolioText: 'Writ petitions (fictional)',
        confidence: 1,
        anchor,
      },
      {
        hallNo: '2',
        judges: ['Justice B (fictional)', 'Justice C (fictional)'],
        portfolioText: 'Criminal appeals (fictional)',
        confidence: 0.9,
        anchor,
      },
      {
        hallNo: '7',
        judges: ['Justice X (fictional)'],
        portfolioText: 'Second appeals (fictional)',
        confidence: 0.4,
        anchor,
      },
    ],
    ...overrides,
  };
}

const ok = (): Confirmed => ({
  ok: true,
  data: {
    rosterId: 'r-1',
    version: 2,
    effectiveFrom: '2026-10-05',
    alertsCreated: 1,
    detection: 'ok',
  },
});

const preview = vi.fn<(input: unknown) => Promise<Result<Preview>>>();
const confirm = vi.fn<(input: unknown) => Promise<Confirmed>>();
const upload = vi.fn<(workspaceId: string, file: File) => Promise<UploadResult>>();

function renderReview(
  props: { initialPreview?: Preview | undefined; hasActiveRoster?: boolean } = {},
) {
  const initialPreview = 'initialPreview' in props ? props.initialPreview : previewOf();
  return renderWithIntl(
    <RosterImportReview
      slug="demo"
      workspaceId={WS}
      forum={FORUM}
      hasActiveRoster={props.hasActiveRoster ?? false}
      preview={preview}
      confirm={confirm}
      upload={upload}
      {...(initialPreview === undefined ? {} : { initialPreview })}
    />,
  );
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

const grid = () => screen.getByRole('grid', { name: en.grid.label });
const cell = (row: number, column: string) => {
  const rows = within(grid()).getAllByRole('row').slice(1);
  const found = (rows[row] as HTMLElement).querySelector<HTMLElement>(`[data-column="${column}"]`);
  if (found === null) throw new Error(`no ${column} cell in row ${String(row)}`);
  return found;
};
const key = (init: KeyboardEventInit & { key: string }) => {
  fireEvent.keyDown(document.activeElement ?? document.body, init);
};
const editor = () => document.activeElement as HTMLInputElement;
const announced = () => document.querySelector('[data-roster-import-announce]')?.textContent;

function editCell(row: number, column: string, value: string) {
  act(() => {
    cell(row, column).focus();
  });
  key({ key: 'Enter' });
  fireEvent.change(editor(), { target: { value } });
  key({ key: 'Enter' });
}

beforeEach(() => {
  stubResizeObserver();
  setOnline(true);
  preview.mockReset();
  confirm.mockReset();
  upload.mockReset();
  router.push.mockReset();
  toast.mockReset();
});

afterEach(cleanup);

describe('parsing helpers', () => {
  it('splits judges on semicolons and new lines', () => {
    expect(parseJudges(' Justice A ;Justice  B\n\n; ')).toEqual(['Justice A', 'Justice B']);
  });

  it('normalises case types as the confirm schema wants them', () => {
    expect(parseCaseTypes('wp, W.P., crl.a ; s a')).toEqual(['WP', 'CRLA', 'SA']);
  });

  it('reads a year or a range, and refuses anything else', () => {
    expect(parseYearRange('')).toEqual({});
    expect(parseYearRange('2021')).toEqual({ yearFrom: 2021, yearTo: 2021 });
    expect(parseYearRange('2020-2024')).toEqual({ yearFrom: 2020, yearTo: 2024 });
    expect(parseYearRange('2020 to 2024')).toEqual({ yearFrom: 2020, yearTo: 2024 });
    expect(parseYearRange('2020-')).toEqual({ yearFrom: 2020 });
    expect(parseYearRange('-2024')).toEqual({ yearTo: 2024 });
    expect(parseYearRange('2024-2020')).toBeNull();
    expect(parseYearRange('1800')).toBeNull();
    expect(parseYearRange('soon')).toBeNull();
  });

  it('sends a rule only when the lawyer gave one', () => {
    expect(
      toConfirmedEntries([
        {
          key: 'a',
          hallNo: ' 1 ',
          judges: ['J'],
          portfolioText: ' P ',
          caseTypes: [],
          confidence: 1,
        },
        {
          key: 'b',
          hallNo: '2',
          judges: ['K'],
          portfolioText: '',
          caseTypes: ['WP'],
          yearFrom: 2020,
          confidence: 1,
        },
      ]),
    ).toEqual([
      { hallNo: '1', judges: ['J'], portfolioText: 'P' },
      {
        hallNo: '2',
        judges: ['K'],
        portfolioText: '',
        portfolioRule: { caseTypes: ['WP'], yearFrom: 2020 },
      },
    ]);
  });
});

describe('RosterImportReview grid (#436)', () => {
  it('shows the parsed rows in a role="grid" with every column', () => {
    renderReview();
    const table = grid();
    expect(table.getAttribute('aria-rowcount')).toBe('4');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      en.grid.hall,
      en.grid.judges,
      en.grid.portfolio,
      en.grid.caseTypes,
      en.grid.years,
      en.grid.confidence,
      en.grid.removeColumn,
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getAllByRole('gridcell')).toHaveLength(7);
    expect(cell(1, 'judges').textContent).toBe('Justice B (fictional)Justice C (fictional)');
    expect(cell(0, 'portfolio').className).toContain('text-ink-muted');
    // One tab stop: the first cell.
    expect(table.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(cell(0, 'hall').tabIndex).toBe(0);
  });

  it('warns on rows below 0.6 confidence with an icon and text, and counts them', () => {
    renderReview();
    const low = cell(2, 'confidence');
    expect(low.textContent).toContain(en.confidence.low);
    expect(low.querySelector('svg')).not.toBeNull();
    expect(low.closest('tr')?.hasAttribute('data-low-confidence')).toBe(true);
    expect(cell(1, 'confidence').textContent).toContain(en.confidence.ok);
    expect(cell(1, 'confidence').closest('tr')?.hasAttribute('data-low-confidence')).toBe(false);
    const summary = screen.getByRole('group', { name: en.summary.label });
    expect(summary.textContent).toContain('3 halls');
    expect(summary.textContent).toContain('1 row to check');
  });

  it('moves with the arrow keys, Home and End', () => {
    renderReview();
    act(() => {
      cell(0, 'hall').focus();
    });
    key({ key: 'ArrowRight' });
    expect(document.activeElement).toBe(cell(0, 'judges'));
    key({ key: 'ArrowDown' });
    expect(document.activeElement).toBe(cell(1, 'judges'));
    key({ key: 'ArrowDown' });
    key({ key: 'ArrowDown' });
    expect(document.activeElement).toBe(cell(2, 'judges'));
    key({ key: 'ArrowUp' });
    key({ key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cell(1, 'hall'));
    key({ key: 'End' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove hall 2');
    key({ key: 'Home' });
    expect(document.activeElement).toBe(cell(1, 'hall'));
    expect(cell(1, 'hall').tabIndex).toBe(0);
    expect(cell(0, 'hall').tabIndex).toBe(-1);
  });

  it('edits a cell with Enter, commits with Enter and announces the edit', () => {
    renderReview();
    act(() => {
      cell(1, 'judges').focus();
    });
    key({ key: 'Enter' });
    expect(editor().tagName).toBe('INPUT');
    expect(editor().getAttribute('aria-label')).toBe('Edit Judges for hall 2');
    expect(editor().value).toBe('Justice B (fictional); Justice C (fictional)');
    fireEvent.change(editor(), { target: { value: 'Justice D (fictional)' } });
    key({ key: 'Enter' });
    expect(cell(1, 'judges').textContent).toBe('Justice D (fictional)');
    expect(document.activeElement).toBe(cell(1, 'judges'));
    expect(announced()).toBe('Judges for hall 2 changed to Justice D (fictional).');
  });

  it('cancels an edit with Escape', () => {
    renderReview();
    act(() => {
      cell(0, 'portfolio').focus();
    });
    key({ key: 'Enter' });
    fireEvent.change(editor(), { target: { value: 'Something else' } });
    key({ key: 'Escape' });
    expect(cell(0, 'portfolio').textContent).toBe('Writ petitions (fictional)');
    expect(document.activeElement).toBe(cell(0, 'portfolio'));
    expect(announced()).toBe('');
  });

  it('shows case-type and year chips, and refuses a year range it cannot read', () => {
    renderReview();
    editCell(0, 'caseTypes', 'wp, crl.a');
    const chips = cell(0, 'caseTypes').querySelectorAll('[data-rule-chip="caseType"]');
    expect([...chips].map((c) => c.textContent)).toEqual(['WP', 'CRLA']);
    editCell(0, 'years', '2020-2024');
    expect(cell(0, 'years').querySelector('[data-rule-chip="years"]')?.textContent).toBe(
      '2020 to 2024',
    );
    act(() => {
      cell(1, 'years').focus();
    });
    key({ key: 'Enter' });
    fireEvent.change(editor(), { target: { value: 'soon' } });
    key({ key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe(en.grid.invalidYears);
    expect(editor().tagName).toBe('INPUT');
  });

  it('removes a row and announces it', async () => {
    renderReview();
    fireEvent.click(screen.getByRole('button', { name: 'Remove hall 2' }));
    expect(announced()).toBe('Hall 2 removed.');
    expect(screen.getByRole('group', { name: en.summary.label }).textContent).toContain('2 halls');
    await waitFor(() => {
      expect(within(grid()).getAllByRole('row')).toHaveLength(3);
    });
  });
});

describe('RosterImportReview confirm (#436)', () => {
  it('confirms with Ctrl+Enter, sending the reviewed rows and the date', async () => {
    confirm.mockResolvedValue(ok());
    renderReview();
    editCell(0, 'caseTypes', 'W.P.');
    act(() => {
      cell(0, 'hall').focus();
    });
    key({ key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledOnce();
    });
    expect(confirm.mock.calls[0]?.[0]).toEqual({
      workspaceId: WS,
      forumId: FORUM.id,
      effectiveFrom: '2026-10-05',
      entries: [
        {
          hallNo: '1',
          judges: ['Justice A (fictional)'],
          portfolioText: 'Writ petitions (fictional)',
          portfolioRule: { caseTypes: ['WP'] },
        },
        {
          hallNo: '2',
          judges: ['Justice B (fictional)', 'Justice C (fictional)'],
          portfolioText: 'Criminal appeals (fictional)',
        },
        {
          hallNo: '7',
          judges: ['Justice X (fictional)'],
          portfolioText: 'Second appeals (fictional)',
        },
      ],
    });
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(
        `/w/demo/courts/rosters?forum=${encodeURIComponent(FORUM.code)}`,
      );
    });
    expect(toast).toHaveBeenCalledWith('Roster confirmed from 5 Oct 2026.', {
      description: 'The bench changed on 1 matter.',
    });
  });

  it('confirms with Cmd+Enter from inside a cell editor, keeping the edit', async () => {
    confirm.mockResolvedValue(ok());
    renderReview();
    act(() => {
      cell(2, 'hall').focus();
    });
    key({ key: 'Enter' });
    fireEvent.change(editor(), { target: { value: '7A' } });
    key({ key: 'Enter', metaKey: true });
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledOnce();
    });
    const input = confirm.mock.calls[0]?.[0] as { entries: { hallNo: string }[] };
    expect(input.entries.map((e) => e.hallNo)).toEqual(['1', '2', '7A']);
  });

  it('has a single Confirm roster action', async () => {
    confirm.mockResolvedValue(ok());
    renderReview();
    const buttons = screen.getAllByRole('button', { name: en.confirm });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledOnce();
    });
  });

  it('requires the effective-from date, with the parse-error note when the PDF had none', async () => {
    confirm.mockResolvedValue(ok());
    renderReview({
      initialPreview: previewOf({ effectiveFrom: null, effectiveFromRequired: true }),
    });
    expect(screen.getByText(en.parseError)).toBeTruthy();
    const date = screen.getByLabelText<HTMLInputElement>(en.effectiveFrom.label);
    expect(date.value).toBe('');
    expect(date.required).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(en.effectiveFrom.required);
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(date);

    fireEvent.change(date, { target: { value: '2026-11-02' } });
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledOnce();
    });
    expect((confirm.mock.calls[0]?.[0] as { effectiveFrom: string }).effectiveFrom).toBe(
      '2026-11-02',
    );
  });

  it('prefills the date the PDF states', () => {
    renderReview();
    const date = screen.getByLabelText<HTMLInputElement>(en.effectiveFrom.label);
    expect(date.value).toBe('2026-10-05');
    expect(screen.getByText(en.effectiveFrom.fromPdf)).toBeTruthy();
    expect(screen.queryByText(en.parseError)).toBeNull();
  });

  it('blocks a row with no judge or a blank hall and focuses it', () => {
    renderReview({
      initialPreview: previewOf({
        candidates: [
          {
            hallNo: '1',
            judges: ['Justice A (fictional)'],
            portfolioText: '',
            confidence: 1,
            anchor,
          },
          { hallNo: '3', judges: [], portfolioText: '', confidence: 0.3, anchor },
        ],
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(en.validation.fix);
    expect(cell(1, 'judges').textContent).toBe(en.validation.judges);
    expect(cell(1, 'judges').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(cell(1, 'judges'));
  });

  it('asks before superseding an active roster, then confirms with supersedeCurrent', async () => {
    confirm.mockResolvedValue(ok());
    renderReview({ hasActiveRoster: true });
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    const dialog = await screen.findByRole('dialog', { name: en.supersede.title });
    expect(confirm).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('active from 5 Oct 2026');
    fireEvent.click(within(dialog).getByRole('button', { name: en.supersede.confirm }));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledOnce();
    });
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({ supersedeCurrent: true });
  });

  it('keeps reviewing when the lawyer cancels the supersede', async () => {
    renderReview({ hasActiveRoster: true });
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.supersede.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('opens the supersede Dialog on a CONFLICT from the action', async () => {
    confirm
      .mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'active' } })
      .mockResolvedValueOnce(ok());
    renderReview();
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    const dialog = await screen.findByRole('dialog', { name: en.supersede.title });
    fireEvent.click(within(dialog).getByRole('button', { name: en.supersede.confirm }));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(2);
    });
    expect(confirm.mock.calls[1]?.[0]).toMatchObject({ supersedeCurrent: true });
  });

  it('says when bench changes could not be checked', async () => {
    const result = ok();
    if (result.ok) result.data.detection = 'failed';
    confirm.mockResolvedValue(result);
    renderReview();
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Roster confirmed from 5 Oct 2026.', {
        description: en.detectionFailed,
      });
    });
  });

  it('reports a failed confirm and stays on the review', async () => {
    confirm.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: '' } });
    renderReview();
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    expect((await screen.findByRole('alert')).textContent).toBe(en.failed);
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('RosterImportReview upload (#436)', () => {
  const pdf = () => new File(['%PDF-'], 'roster.pdf', { type: 'application/pdf' });
  const choose = (file: File) => {
    fireEvent.change(screen.getByLabelText(en.upload.label), { target: { files: [file] } });
  };

  it('uploads the PDF, previews it for the forum and opens the review', async () => {
    upload.mockResolvedValue({ ok: true, blobId: BLOB });
    preview.mockResolvedValue({ ok: true, data: previewOf() });
    renderReview({ initialPreview: undefined });
    choose(pdf());
    await screen.findByRole('grid');
    expect(upload).toHaveBeenCalledWith(WS, expect.any(File));
    expect(preview).toHaveBeenCalledWith({ workspaceId: WS, blobId: BLOB, forumCode: FORUM.code });
  });

  it('shows the loading rows while reading', async () => {
    upload.mockReturnValue(new Promise(() => undefined));
    renderReview({ initialPreview: undefined });
    choose(pdf());
    expect((await screen.findByRole('status')).textContent).toBe(en.upload.uploading);
    expect(document.querySelector('[data-pattern-state="loading"]')).not.toBeNull();
  });

  it('refuses a file that is not a PDF', () => {
    renderReview({ initialPreview: undefined });
    choose(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(screen.getByRole('alert').textContent).toBe(en.upload.notPdf);
    expect(upload).not.toHaveBeenCalled();
  });

  it('says when the file is too large', async () => {
    upload.mockResolvedValue({ ok: false, error: 'too_large' });
    renderReview({ initialPreview: undefined });
    choose(pdf());
    expect((await screen.findByRole('alert')).textContent).toBe(en.upload.tooLarge);
  });

  it('shows the unreadable state on a VALIDATION from the preview, and lets the lawyer retry', async () => {
    upload.mockResolvedValue({ ok: true, blobId: BLOB });
    preview.mockResolvedValue({ ok: false, error: { code: 'VALIDATION', message: 'unreadable' } });
    renderReview({ initialPreview: undefined });
    choose(pdf());
    expect(await screen.findByText(en.unreadable.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.unreadable.retry }));
    expect(screen.getByLabelText(en.upload.label)).toBeTruthy();
  });

  it('says when the PDF has no halls', async () => {
    upload.mockResolvedValue({ ok: true, blobId: BLOB });
    preview.mockResolvedValue({ ok: true, data: previewOf({ candidates: [] }) });
    renderReview({ initialPreview: undefined });
    choose(pdf());
    expect(await screen.findByText(en.noRows)).toBeTruthy();
  });

  it('disables the upload while offline', () => {
    setOnline(false);
    renderReview({ initialPreview: undefined });
    expect(screen.getByLabelText<HTMLInputElement>(en.upload.label).disabled).toBe(true);
    expect(screen.getByText(catalogs.en.courtsRosters.importOffline)).toBeTruthy();
  });
});
