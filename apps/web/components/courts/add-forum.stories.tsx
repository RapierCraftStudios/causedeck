// The courts index's lazy `Add forum` entry point (#427): the static button, and the dialog (#402)
// once its chunk has loaded on click. The dialog's own states live in `add-forum-dialog.stories.tsx`;
// the server action is a prop, mocked here with `fn()`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fireEvent, fn, screen, waitFor } from 'storybook/test';

import en from '@causedeck/i18n/messages/en.json';

import type { Result } from '../../lib/safe-action.ts';
import { AddForum } from './add-forum.tsx';
import type { AddForumInput } from './add-forum-dialog.tsx';

type ActionResult = Result<{ code: string; court: string }>;
type Action = (input: AddForumInput) => Promise<ActionResult>;

const t = en.courts.addForum;

const meta = {
  title: 'Courts/AddForum',
  component: AddForum,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    takenCodes: ['in.ka.bengaluru.city-civil'],
    action: fn<Action>((input) =>
      Promise.resolve({ ok: true, data: { code: input.code, court: input.name } }),
    ),
  },
} satisfies Meta<typeof AddForum>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: t.trigger })).toBeVisible();
  },
};

/** A click opens the dialog once its chunk has loaded. */
export const Opens: Story = {
  play: async ({ canvas }) => {
    // One synchronous click: userEvent's pointer sequence spans several ticks, and if the idle
    // prefetch lands in between, the static button is swapped for the dialog's trigger and the click
    // reaches a detached node.
    await fireEvent.click(canvas.getByRole('button', { name: t.trigger }));
    // The dialog chunk loads lazily; a cold dark-theme run can exceed waitFor's 1 s default.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible(), { timeout: 5000 });
  },
};
