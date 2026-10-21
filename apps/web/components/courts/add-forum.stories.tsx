// Add-forum entry point (#427): the static `Add forum` button that loads the dialog chunk
// (`add-forum-dialog.tsx`, #402) at idle or on hover, focus or click. The server action is a prop,
// mocked here with `fn()`. Covers the button, a click opening the dialog once it has loaded, and the
// Tamil and Kannada labels. The dialog's own states are in `add-forum-dialog.stories.tsx`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';

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

/** A click opens the dialog, whether or not its chunk had loaded yet. */
export const OpensDialog: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: t.trigger }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  },
};

export const Tamil: Story = {
  globals: { locale: 'ta' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toBeVisible();
  },
};

export const Kannada: Story = {
  globals: { locale: 'kn' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toBeVisible();
  },
};
