// Merge and split dialogs (#392): preview of what moves, blocked pairs, offline, failures. Actions
// are mocked with `fn()`; both dialogs render open in a portal, so queries go through `screen`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';

import {
  MergeMatterDialog,
  SplitMatterDialog,
  type MergeActions,
  type MovePreviewView,
  type SplitActions,
} from './merge-split-dialogs.tsx';

const WS = '00000000-0000-4000-8000-000000000001';
const MATTER = '00000000-0000-4000-8000-0000000b0001';
const OTHER = '00000000-0000-4000-8000-0000000b0002';

const preview = (over: Partial<MovePreviewView> = {}): MovePreviewView => ({
  proceedings: [
    { id: 'p1', caseType: 'W.P.', number: '1234', year: 2025 },
    { id: 'p2', caseType: 'W.M.P.', number: '88', year: 2025 },
  ],
  documents: 3,
  obligations: 1,
  crossingLinks: 1,
  intoSensitive: false,
  fromSensitive: false,
  blocked: null,
  ...over,
});

const mergeActions = (over: Partial<MovePreviewView> = {}): MergeActions => ({
  search: fn(() =>
    Promise.resolve({
      ok: true as const,
      data: [
        {
          id: OTHER,
          title: 'Selvi v. Fictional Transport Corporation',
          forum: 'Madras High Court',
          sensitive: false,
        },
      ],
    }),
  ),
  preview: fn(() => Promise.resolve({ ok: true as const, data: preview(over) })),
  merge: fn(() => Promise.resolve({ ok: true as const, data: { undo: {} } })),
  undo: fn(() => Promise.resolve({ ok: true as const, data: {} })),
});

const splitActions = (over: Partial<MovePreviewView> = {}): SplitActions => ({
  preview: fn(() => Promise.resolve({ ok: true as const, data: preview(over) })),
  split: fn(() =>
    Promise.resolve({
      ok: true as const,
      data: { undo: {}, newMatterHref: `/w/demo/matters/${OTHER}` },
    }),
  ),
  undo: fn(() => Promise.resolve({ ok: true as const, data: {} })),
});

const meta = {
  title: 'Matters/MergeSplitDialogs',
  component: MergeMatterDialog,
  args: { workspaceId: WS, matterId: MATTER, actions: mergeActions(), onClose: fn() },
} satisfies Meta<typeof MergeMatterDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = () => waitFor(() => screen.getByRole('dialog'));

export const MergeOpen: Story = {
  play: async () => {
    await expect(await dialog()).toBeVisible();
    await expect(screen.getByRole('searchbox')).toBeVisible();
  },
};

export const MergePreview: Story = {
  args: { initialMatterId: OTHER },
  play: async () => {
    await dialog();
    await expect(await screen.findByText('What moves here')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Merge matters' })).toBeEnabled();
  },
};

export const MergeBlocked: Story = {
  args: { initialMatterId: OTHER, actions: mergeActions({ blocked: 'restricted' }) },
  play: async () => {
    await dialog();
    await expect(
      await screen.findByText(
        "These matters are restricted to different people, so they can't be merged.",
      ),
    ).toBeVisible();
    // A blocked merge offers no Merge button at all, not a disabled one.
    await expect(screen.queryByRole('button', { name: 'Merge matters' })).toBeNull();
  },
};

export const MergeOffline: Story = {
  args: { initialMatterId: OTHER, offline: true },
  play: async () => {
    await dialog();
    await expect(await screen.findByRole('button', { name: 'Merge matters' })).toBeDisabled();
  },
};

export const MergeTamil: Story = {
  args: { initialMatterId: OTHER },
  globals: { locale: 'ta' },
};

export const MergeKannada: Story = {
  args: { initialMatterId: OTHER },
  globals: { locale: 'kn' },
};

const split = (over: Partial<Story> = {}) =>
  ({
    render: (args: Story['args']) => (
      <SplitMatterDialog
        workspaceId={WS}
        slug="demo"
        matterId={MATTER}
        proceedingIds={['p1', 'p2']}
        actions={splitActions()}
        onClose={args?.onClose ?? fn()}
      />
    ),
    ...over,
  }) satisfies Story;

export const SplitOpen: Story = {
  ...split(),
  play: async () => {
    await dialog();
    await expect(await screen.findByText('What moves')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Split matter' })).toBeVisible();
  },
};

export const SplitTamil: Story = { ...split(), globals: { locale: 'ta' } };

export const SplitKannada: Story = { ...split(), globals: { locale: 'kn' } };
