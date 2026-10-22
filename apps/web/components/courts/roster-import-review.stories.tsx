// Roster import review (#436): the upload, actions and router are mocks (`fn()` and the framework's
// router). Every state: choose a file, offline, reading (loading rows), an unreadable PDF, a PDF
// with no halls, the review with a low-confidence row, the missing effective date (parse error),
// a row with no judge blocked, the supersede Dialog over an active roster, confirming, the forum
// picker, dark mode and the ta/kn drafts.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import en from '@causedeck/i18n/messages/en.json';

import type { Result } from '../../lib/safe-action.ts';
import type { UploadResult } from '../../lib/upload-client.ts';
import {
  RosterImportForumSelect,
  RosterImportReview,
  type ConfirmedRosterImport,
  type ConfirmRosterInput,
  type PreviewRosterInput,
  type RosterImportPreview,
} from './roster-import-review.tsx';

const t = en.courtsRosters.import;
const anchor = { pageNo: 1, quote: 'COURT HALL No. 1' };

const PREVIEW: RosterImportPreview = {
  forumCode: 'in.tn.madras-hc.principal.appellate',
  effectiveFrom: { date: '2026-10-05', anchor },
  effectiveFromRequired: false,
  candidates: [
    {
      hallNo: '1',
      judges: ['Justice A (fictional)'],
      portfolioText: 'Writ petitions relating to land acquisition (fictional)',
      confidence: 1,
      anchor,
    },
    {
      hallNo: '2',
      judges: ['Justice B (fictional)', 'Justice C (fictional)'],
      portfolioText: 'Criminal appeals of 2015 onwards (fictional)',
      confidence: 0.85,
      anchor,
    },
    {
      hallNo: '7',
      judges: ['Justice X (fictional)'],
      portfolioText: 'Second appeals (fictional)',
      confidence: 0.45,
      anchor,
    },
  ],
};

const NO_DATE: RosterImportPreview = {
  ...PREVIEW,
  effectiveFrom: null,
  effectiveFromRequired: true,
};

const confirmed = (): Promise<Result<ConfirmedRosterImport>> =>
  Promise.resolve({
    ok: true,
    data: {
      rosterId: 'r-1',
      version: 2,
      effectiveFrom: '2026-10-05',
      alertsCreated: 1,
      detection: 'ok',
    },
  });
const uploaded = (): Promise<UploadResult> =>
  Promise.resolve({ ok: true, blobId: '00000000-0000-4000-8000-0000000000b1' });
const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

type Preview = (input: PreviewRosterInput) => Promise<Result<RosterImportPreview>>;
type Confirm = (input: ConfirmRosterInput) => Promise<Result<ConfirmedRosterImport>>;
type Upload = (workspaceId: string, file: File) => Promise<UploadResult>;

const meta = {
  title: 'Courts/RosterImportReview',
  component: RosterImportReview,
  args: {
    slug: 'demo',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    forum: {
      id: '00000000-0000-4000-8000-0000000000f1',
      code: 'in.tn.madras-hc.principal.appellate',
      court: 'Madras High Court',
    },
    hasActiveRoster: false,
    preview: fn<Preview>(() => Promise.resolve({ ok: true, data: PREVIEW })),
    confirm: fn<Confirm>(confirmed),
    upload: fn<Upload>(uploaded),
  },
} satisfies Meta<typeof RosterImportReview>;

export default meta;
type Story = StoryObj<typeof meta>;

const pdf = () => new File(['%PDF-'], 'roster.pdf', { type: 'application/pdf' });

/** Choose a file: nothing parsed yet. */
export const Upload: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText(t.upload.label)).toBeEnabled();
    await expect(canvas.getByText(t.upload.hint)).toBeVisible();
  },
};

/** Offline: the upload is disabled with a note. */
export const UploadOffline: Story = {
  beforeEach: () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    return () => {
      delete (navigator as { onLine?: boolean }).onLine;
      if (original) Object.defineProperty(Navigator.prototype, 'onLine', original);
    };
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText(t.upload.label)).toBeDisabled();
    await expect(canvas.getByText(en.courtsRosters.importOffline)).toBeVisible();
  },
};

/** Uploading and parsing: loading skeleton rows. */
export const Reading: Story = {
  args: { upload: fn<Upload>(never) },
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByLabelText(t.upload.label), pdf());
    await expect(await canvas.findByText(t.upload.uploading)).toBeVisible();
  },
};

/** The preview could not read the PDF. */
export const Unreadable: Story = {
  args: {
    preview: fn<Preview>(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'VALIDATION' as const, message: 'We could not read this PDF' },
      }),
    ),
  },
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByLabelText(t.upload.label), pdf());
    await expect(await canvas.findByText(t.unreadable.title)).toBeVisible();
    await expect(canvas.getByRole('button', { name: t.unreadable.retry })).toBeVisible();
  },
};

/** A readable PDF with no halls in it. */
export const NoHalls: Story = {
  args: {
    preview: fn<Preview>(() =>
      Promise.resolve({ ok: true as const, data: { ...PREVIEW, candidates: [] } }),
    ),
  },
  play: async ({ canvas }) => {
    await userEvent.upload(canvas.getByLabelText(t.upload.label), pdf());
    await expect(await canvas.findByText(t.noRows)).toBeVisible();
  },
};

/** The parsed rows, one read with low confidence. */
export const Review: Story = {
  args: { initialPreview: PREVIEW },
  play: async ({ canvas }) => {
    const grid = canvas.getByRole('grid', { name: t.grid.label });
    await expect(grid).toBeVisible();
    await expect(within(grid).getByText(t.confidence.low, { exact: false })).toBeVisible();
    await expect(canvas.getByText('1 row to check')).toBeVisible();
  },
};

/** Keyboard: Enter edits a cell, Enter commits, the edit is announced. */
export const EditCell: Story = {
  args: { initialPreview: PREVIEW },
  play: async ({ canvas }) => {
    const grid = canvas.getByRole('grid', { name: t.grid.label });
    const first = grid.querySelector<HTMLElement>('[data-cell="0-0"]');
    first?.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{Enter}');
    await userEvent.keyboard('WP, CRL.A{Enter}');
    await expect(within(grid).getByText('CRLA')).toBeVisible();
  },
};

/** The PDF stated no date: the parse-error note and an empty, required date. */
export const MissingEffectiveDate: Story = {
  args: { initialPreview: NO_DATE },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByText(t.parseError)).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: t.confirm }));
    await expect(canvas.getByRole('alert')).toHaveTextContent(t.effectiveFrom.required);
    await expect(args.confirm).not.toHaveBeenCalled();
  },
};

/** A row with no judge blocks confirm. */
export const RowWithoutJudges: Story = {
  args: {
    initialPreview: {
      ...PREVIEW,
      candidates: [
        ...PREVIEW.candidates,
        { hallNo: '9', judges: [], portfolioText: '', confidence: 0.2, anchor },
      ],
    },
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: t.confirm }));
    await expect(canvas.getByText(t.validation.judges)).toBeVisible();
    await expect(args.confirm).not.toHaveBeenCalled();
  },
};

/** The forum has an active roster: the Dialog asks before superseding it. */
export const SupersedeDialog: Story = {
  args: { initialPreview: PREVIEW, hasActiveRoster: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: t.confirm }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
    await expect(screen.getByText(t.supersede.title)).toBeVisible();
  },
};

/** Confirming: the action has not answered yet. */
export const Confirming: Story = {
  args: { initialPreview: PREVIEW, confirm: fn<Confirm>(never) },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: t.confirm }));
    await expect(await canvas.findByRole('button', { name: t.confirming })).toBeDisabled();
  },
};

/** No forum chosen yet. */
export const ChooseForum: Story = {
  render: () => (
    <RosterImportForumSelect
      slug="demo"
      forums={[
        {
          code: 'in.tn.madras-hc.principal.appellate',
          court: 'Madras High Court',
          seat: 'Chennai',
        },
        { code: 'in.ka.karnataka-hc.bengaluru', court: 'High Court of Karnataka', seat: null },
      ]}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: t.chooseForum.label })).toBeVisible();
  },
};

export const Dark: Story = { args: { initialPreview: PREVIEW }, globals: { theme: 'dark' } };

export const Tamil: Story = { args: { initialPreview: PREVIEW }, globals: { locale: 'ta' } };

export const Kannada: Story = { args: { initialPreview: PREVIEW }, globals: { locale: 'kn' } };
