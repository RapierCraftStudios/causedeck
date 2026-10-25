// Calendar import review (#53): the actions are mocks. A matched event with a next-date proposal, a
// conflict with the confirmed date, an unmatched event with the note form, still reading, and an
// empty file. Rows are confirmed or skipped one at a time: there is no bulk action.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { ImportReview, type ReviewRowView } from './import-review.tsx';

const ROWS: ReviewRowView[] = [
  {
    uid: 'a@example.test',
    status: 'proposed',
    summary: 'W.P. 12345/2026 hearing (fictional)',
    location: 'Court 12',
    eventDate: '2026-12-02',
    eventTime: '10:30',
    matterId: '00000000-0000-4000-8000-0000000000a1',
    preview: { kind: 'next_date', date: '2026-12-02' },
  },
  {
    uid: 'b@example.test',
    status: 'proposed',
    summary: 'CRL OP 77/2026 posted (fictional)',
    location: null,
    eventDate: '2026-12-09',
    eventTime: null,
    matterId: '00000000-0000-4000-8000-0000000000a2',
    preview: { kind: 'conflict', date: '2026-12-09' },
  },
  {
    uid: 'c@example.test',
    status: 'unmatched',
    summary: 'High Court mention (fictional)',
    location: 'High Court',
    eventDate: '2026-12-11',
    eventTime: '11:00',
    matterId: null,
    preview: { kind: 'none' },
  },
];

const meta = {
  title: 'Settings/Calendar/ImportReview',
  component: ImportReview,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    captureId: '00000000-0000-4000-8000-0000000000c1',
    captureStatus: 'needs_you',
    summary: { new: 2, changed: 0, unchanged: 10, ignored: 4 },
    rows: ROWS,
    matters: [
      { id: '00000000-0000-4000-8000-0000000000a3', title: 'Example v Example (fictional)' },
    ],
    actions: {
      confirm: fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { uid: 'a@example.test', status: 'applied' as const },
        }),
      ),
      skip: fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { uid: 'a@example.test', status: 'skipped' as const },
        }),
      ),
      note: fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { uid: 'c@example.test', status: 'noted' as const },
        }),
      ),
    },
  },
} satisfies Meta<typeof ImportReview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Review: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/confirm all/i)).toBeNull();
    const [firstSkip] = canvas.getAllByRole('button', { name: 'Skip' });
    if (firstSkip) await userEvent.click(firstSkip);
  },
};

export const Reading: Story = { args: { captureStatus: 'processing', summary: null, rows: [] } };

export const Empty: Story = {
  args: {
    captureStatus: 'ready',
    rows: [],
    summary: { new: 0, changed: 0, unchanged: 0, ignored: 3 },
  },
};

export const Failed: Story = { args: { captureStatus: 'failed', summary: null, rows: [] } };
