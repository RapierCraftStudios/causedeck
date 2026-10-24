// New-matter dialog (#388): the server action is a prop, mocked with `fn()`. Covers closed, open,
// offline (cannot submit), the required-title error and the server's FORBIDDEN answer.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, waitFor } from 'storybook/test';

import type { Result } from '../../lib/safe-action.ts';
import {
  NewMatterDialog,
  type CreateMatterAction,
  type NewMatterInput,
} from './new-matter-dialog.tsx';

type ActionResult = Result<{ id: string; title: string }>;

const ok = (input: NewMatterInput): Promise<ActionResult> =>
  Promise.resolve({
    ok: true,
    data: { id: '00000000-0000-4000-8000-0000000b00ff', title: input.title },
  });
const forbidden = (): Promise<ActionResult> =>
  Promise.resolve({ ok: false, error: { code: 'FORBIDDEN', message: '' } });

const meta = {
  title: 'Matters/NewMatterDialog',
  component: NewMatterDialog,
  args: {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    action: fn<CreateMatterAction>(ok),
    open: true,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof NewMatterDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async () => {
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    await expect(dialog).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Create matter' })).toBeVisible();
  },
};

export const Closed: Story = {
  args: { open: false },
  play: async () => {
    await expect(screen.queryByRole('dialog')).toBeNull();
  },
};

export const Offline: Story = {
  args: { offline: true },
  play: async () => {
    await waitFor(() => screen.getByRole('dialog'));
    await expect(screen.getByText(/You're offline/)).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Create matter' })).toBeDisabled();
  },
};

export const RequiredTitle: Story = {
  play: async ({ userEvent }) => {
    await waitFor(() => screen.getByRole('dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Create matter' }));
    await expect(await screen.findByText('Enter a title.')).toBeVisible();
  },
};

export const Forbidden: Story = {
  args: { action: fn<CreateMatterAction>(forbidden) },
  play: async ({ userEvent }) => {
    await waitFor(() => screen.getByRole('dialog'));
    await userEvent.type(screen.getByLabelText(/Title/), 'Rao v. State of Tamil Nadu');
    await userEvent.click(screen.getByRole('button', { name: 'Create matter' }));
    await expect(await screen.findByText("Your role can't add matters.")).toBeVisible();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
