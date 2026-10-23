// The states of the bootstrap import around the confirm grid (#553): drop zone, file list,
// processing (reading, partial failure, free-plan cap, nothing recognised, error), the grid with a
// W.P. + W.M.P. group and an appeal chain, and the result summary. Fictional data only.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import en from '@causedeck/i18n/messages/en.json';

import type { ImportEntry } from '../../lib/import/file-rules.ts';

import { PLAN, proceeding } from './__tests__/fixtures.ts';
import { ConfirmGrid } from './confirm-grid.tsx';
import { DropZone } from './drop-zone.tsx';
import { FileList } from './file-list.tsx';
import { ProcessingView } from './processing-view.tsx';
import { ResultSummary } from './result-summary.tsx';

const meta = {
  title: 'Import/States',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const progress = (over: Partial<Parameters<typeof ProcessingView>[0]['progress']> = {}) => ({
  batchId: 'b',
  status: 'processing',
  total: 4,
  files: { pending: 1, processing: 0, parsed: 2, unmatched: 0, failed: 0 },
  matchedRows: 0,
  keptAsAttachments: 0,
  needsIdentifiers: false,
  ...over,
});

const processing = (over: Parameters<typeof progress>[0] = {}, review = false) => (
  <ProcessingView
    progress={progress(over)}
    retrying={false}
    onRetryFailed={fn()}
    onReview={review ? fn() : undefined}
  />
);

export const DropZoneEmpty: Story = {
  render: () => <DropZone disabled={false} onFiles={fn()} />,
};

const entry = (id: string, status: ImportEntry['status'], name: string): ImportEntry => ({
  id,
  name,
  sizeBytes: 120_000,
  type: 'application/pdf',
  status,
});

export const FileListMixed: Story = {
  render: () => (
    <FileList
      entries={[
        entry('1', 'uploaded', 'cause-list-oct.pdf'),
        entry('2', 'queued', 'diary-page-12.jpg'),
        { ...entry('3', 'failed', 'order-sheet.pdf'), reason: 'size' },
      ]}
      onRetry={fn()}
    />
  ),
};

export const Processing: Story = { render: () => processing() };

export const ProcessingPartialFailure: Story = {
  render: () =>
    processing({ files: { pending: 0, processing: 0, parsed: 2, unmatched: 1, failed: 1 } }),
};

export const ProcessingFreePlanCap: Story = {
  render: () => processing({ keptAsAttachments: 12 }),
};

export const NothingRecognised: Story = {
  render: () =>
    processing({
      status: 'ready',
      files: { pending: 0, processing: 0, parsed: 0, unmatched: 4, failed: 0 },
    }),
};

export const PlanReady: Story = {
  render: () => processing({ status: 'ready', matchedRows: 4 }, true),
};

export const ProcessingError: Story = {
  render: () =>
    processing({
      status: 'failed',
      files: { pending: 0, processing: 0, parsed: 0, unmatched: 0, failed: 4 },
    }),
};

const applied = () =>
  Promise.resolve({
    ok: true as const,
    data: {
      batchId: 'b',
      planHash: 'h',
      rootActivityId: 'r',
      created: {},
      duplicates: 0,
      excluded: 0,
      unresolvedProceedingKeys: [],
    },
  });

const grid = (plan: typeof PLAN) => (
  <ConfirmGrid
    plan={plan}
    courtDayHref="/w/demo/today"
    onConfirm={fn(applied)}
    onUndo={fn(() => Promise.resolve({ ok: true as const, data: null }))}
    onAddIdentifiers={fn()}
    onRetryFile={fn()}
    onKeepFile={fn()}
  />
);

const src = (id: string) => ({ proposalId: id, captureId: null, kind: 'next_date', anchorIds: [] });
const on = (date: string, id: string) => ({ date, sources: [src(id)] });

/** A writ petition with its miscellaneous petition in one matter row. */
export const GridWpWithWmp: Story = {
  render: () =>
    grid({
      ...PLAN,
      matters: [
        {
          tempId: 'm_wp',
          title: 'Rao v State',
          proceedings: [
            proceeding('10', { nextDate: on('2026-11-05', 'd10') }),
            proceeding('11', {
              caseType: 'WMP',
              label: 'W.M.P. 11/2026',
              parentKey: '10',
              nextDate: on('2026-11-05', 'd11'),
            }),
          ],
          nextDate: on('2026-11-05', 'd10'),
          issues: [],
          confidence: 0.95,
          reason: 'main petition with child proceedings',
          sources: [src('p-10'), src('p-11')],
        },
      ],
    }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Rao v State')).toBeVisible();
  },
};

/** An appeal chain: the original suit, its first appeal and the second appeal. */
export const GridAppealChain: Story = {
  render: () =>
    grid({
      ...PLAN,
      matters: [
        {
          tempId: 'm_chain',
          title: 'Menon v Menon',
          proceedings: [
            proceeding('20', {
              caseType: 'OS',
              label: 'O.S. 20/2019',
              forumCode: 'in.tn.chennai.district',
            }),
            proceeding('21', { caseType: 'AS', label: 'A.S. 21/2023', parentKey: '20' }),
            proceeding('22', {
              caseType: 'SA',
              label: 'S.A. 22/2026',
              parentKey: '21',
              nextDate: on('2026-12-02', 'd22'),
            }),
          ],
          nextDate: on('2026-12-02', 'd22'),
          issues: [],
          confidence: 0.9,
          reason: 'appeal chain',
          sources: [src('p-20'), src('p-21'), src('p-22')],
        },
      ],
    }),
};

/** The conflict row blocks the confirm; the SR-stage proceeding is marked unnumbered. */
export const GridConflictAndSrStage: Story = { render: () => grid(PLAN) };

export const Result: Story = {
  render: () => (
    <ResultSummary
      created={{ matters: 3, proceedings: 4, hearings: 2, documents: 1 }}
      duplicates={0}
      unresolvedProceedingKeys={[]}
      courtDayHref="/w/demo/today"
      undoing={false}
      undone={false}
      undoFailed={false}
      onUndo={fn()}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: en.importReview.result.next })).toBeVisible();
  },
};
