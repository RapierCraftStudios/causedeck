// The bootstrap import confirm grid (#551): the plan with a conflict and a low-confidence matter,
// the issues panel, a clean plan, the confirmed result, dark mode and the ta/kn drafts. The actions
// are mocks (`fn()`).
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent } from 'storybook/test';

import en from '@causedeck/i18n/messages/en.json';

import { PLAN } from './__tests__/fixtures.ts';
import { ConfirmGrid } from './confirm-grid.tsx';

const t = en.bootstrapImport;

const applied = () =>
  Promise.resolve({
    ok: true as const,
    data: {
      batchId: 'b',
      planHash: 'h',
      rootActivityId: 'r',
      created: { matters: 3, proceedings: 4, hearings: 2, documents: 1 },
      duplicates: 0,
      excluded: 0,
      unresolvedProceedingKeys: [],
    },
  });

const meta = {
  title: 'Import/ConfirmGrid',
  component: ConfirmGrid,
  args: {
    plan: PLAN,
    courtDayHref: '/w/demo/today',
    onConfirm: fn(applied),
    onUndo: fn(() => Promise.resolve({ ok: true as const, data: null })),
    onAddIdentifiers: fn(),
    onRetryFile: fn(),
    onKeepFile: fn(),
  },
} satisfies Meta<typeof ConfirmGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The conflicting matter blocks the confirm until a date is picked. */
export const Conflict: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText(t.blockedNote)).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Confirm 3 matters/ })).toBeDisabled();
  },
};

/** A date picked: the confirm is enabled and the result offers the first court-day view. */
export const Confirmed: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getAllByRole('button', { name: /Use .*17/ })[0] as HTMLElement);
    await userEvent.click(canvas.getByRole('button', { name: /Confirm 3 matters/ }));
    await expect(await canvas.findByRole('link', { name: t.result.next })).toBeVisible();
  },
};

/** Missing identifiers, an unreadable file and an A0-only document, each with one action. */
export const Issues: Story = {
  args: {
    fileIssues: [
      { kind: 'missing_identifiers' },
      { kind: 'unreadable_file', fileId: 'f1', name: 'diary-page.jpg' },
      { kind: 'a0_only', fileId: 'f2', name: 'cause-list.pdf' },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(t.issues.unreadableCopy)).toBeVisible();
  },
};

/** No conflict and nothing to look at. */
export const Clean: Story = {
  args: { plan: { ...PLAN, matters: PLAN.matters.filter((m) => m.tempId === 'm_late') } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(t.issues.none)).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Confirm 1 matter/ })).toBeEnabled();
  },
};

/** Narrow screen (360): the source preview and issues stack under the grid. */
export const Mobile: Story = { globals: { viewport: { value: 'mobile' } } };

export const Dark: Story = { globals: { theme: 'dark' } };

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };

export const Tablet: Story = { globals: { viewport: { value: 'tablet' } } };

export const Desktop: Story = { globals: { viewport: { value: 'desktop' } } };
