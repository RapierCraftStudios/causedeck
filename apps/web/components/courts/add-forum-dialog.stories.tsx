// Add-forum dialog (#402): the server action is a prop, mocked here with `fn()`; the router and
// toast are the framework's mocks. Covers the suggested code, the client-side taken-code block,
// pending, success and the server's CONFLICT, FORBIDDEN and failure answers.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, waitFor, type userEvent as UserEvent } from 'storybook/test';

import en from '@causedeck/i18n/messages/en.json';

import type { Result } from '../../lib/safe-action.ts';
import { AddForumDialog, type AddForumInput } from './add-forum-dialog.tsx';

type ActionResult = Result<{ code: string; court: string }>;
type Action = (input: AddForumInput) => Promise<ActionResult>;

const t = en.courts.addForum;
const ok = (input: AddForumInput): Promise<ActionResult> =>
  Promise.resolve({ ok: true, data: { code: input.code, court: input.name } });
const failing = (code: 'CONFLICT' | 'FORBIDDEN' | 'INTERNAL') => (): Promise<ActionResult> =>
  Promise.resolve({ ok: false, error: { code, message: '' } });

const meta = {
  title: 'Courts/AddForumDialog',
  component: AddForumDialog,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    takenCodes: ['in.ka.bengaluru.city-civil', 'ws.chennai.family-court'],
    action: fn<Action>(ok),
  },
} satisfies Meta<typeof AddForumDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

type User = ReturnType<typeof UserEvent.setup>;

async function open(user: User) {
  await user.click(screen.getByRole('button', { name: t.trigger }));
  return waitFor(() => screen.getByRole('dialog'));
}

async function fill(user: User, name: string, city: string) {
  await user.type(screen.getByRole('textbox', { name: new RegExp(t.name.label) }), name);
  await user.type(screen.getByRole('textbox', { name: new RegExp(t.city.label) }), city);
}

const submit = (user: User) =>
  user.click(
    screen
      .getAllByRole('button', { name: t.submit })
      .find((button) => button.closest('[role="dialog"]') !== null) ?? document.body,
  );

export const Closed: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: t.trigger })).toBeVisible();
  },
};

export const Open: Story = {
  play: async ({ userEvent }) => {
    await expect(await open(userEvent)).toBeVisible();
  },
};

/** Name and city suggest the code. */
export const Filled: Story = {
  play: async ({ userEvent }) => {
    await open(userEvent);
    await fill(userEvent, 'Family Court', 'Chennai');
    await expect(screen.getByRole('textbox', { name: new RegExp(t.code.label) })).toHaveValue(
      'ws.chennai.family-court',
    );
  },
};

/** The suggested code is already in the index: blocked before the action runs. */
export const CodeTaken: Story = {
  play: async ({ args, userEvent }) => {
    await open(userEvent);
    await fill(userEvent, 'Family Court', 'Chennai');
    await submit(userEvent);
    await expect(await screen.findByText(t.errors.codeTaken)).toBeVisible();
    await expect(args.action).not.toHaveBeenCalled();
  },
};

export const Invalid: Story = {
  play: async ({ userEvent }) => {
    await open(userEvent);
    await submit(userEvent);
    await expect((await screen.findAllByText(t.errors.required)).length).toBeGreaterThan(0);
  },
};

/** The action never answers: the dialog stays open and pending. */
export const Pending: Story = {
  args: { action: fn<Action>(() => new Promise<ActionResult>(() => undefined)) },
  play: async ({ args, userEvent }) => {
    await open(userEvent);
    await fill(userEvent, 'Labour Court', 'Madurai');
    await submit(userEvent);
    await waitFor(() => expect(args.action).toHaveBeenCalledOnce());
    await expect(screen.getByRole('dialog')).toBeVisible();
  },
};

export const Success: Story = {
  play: async ({ args, userEvent }) => {
    await open(userEvent);
    await fill(userEvent, 'Labour Court', 'Madurai');
    await submit(userEvent);
    await waitFor(() => expect(args.action).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
};

/** The server says the code is taken (another member added it meanwhile). */
export const ServerConflict: Story = {
  args: { action: fn<Action>(failing('CONFLICT')) },
  play: async ({ userEvent }) => {
    await open(userEvent);
    await fill(userEvent, 'Labour Court', 'Madurai');
    await submit(userEvent);
    await expect(await screen.findByText(t.errors.codeTaken)).toBeVisible();
  },
};

export const Forbidden: Story = {
  args: { action: fn<Action>(failing('FORBIDDEN')) },
  play: async ({ userEvent }) => {
    await open(userEvent);
    await fill(userEvent, 'Labour Court', 'Madurai');
    await submit(userEvent);
    await expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.forbidden);
  },
};

export const ServerError: Story = {
  args: { action: fn<Action>(failing('INTERNAL')) },
  play: async ({ userEvent }) => {
    await open(userEvent);
    await fill(userEvent, 'Labour Court', 'Madurai');
    await submit(userEvent);
    await expect(await screen.findByRole('alert')).toHaveTextContent(t.errors.failed);
  },
};

export const Tamil: Story = {
  globals: { locale: 'ta' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  },
};

export const Kannada: Story = {
  globals: { locale: 'kn' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  },
};
