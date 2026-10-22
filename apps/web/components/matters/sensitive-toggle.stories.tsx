// Sensitive confirmation (#390): marking or unmarking a matter sensitive always asks first.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { SensitiveDialog, type SetSensitiveAction } from './sensitive-toggle.tsx';

const meta = {
  title: 'Matters/SensitiveDialog',
  component: SensitiveDialog,
  args: {
    workspaceId: '00000000-0000-4000-8000-00000000a001',
    matterId: '00000000-0000-4000-8000-0000000a1001',
    sensitive: false,
    action: fn((): ReturnType<SetSensitiveAction> =>
      Promise.resolve({
        ok: true as const,
        data: { id: '00000000-0000-4000-8000-0000000a1001', sensitive: true },
      }),
    ),
    open: true,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof SensitiveDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mark: Story = {
  play: async () => {
    await expect(await screen.findByRole('alertdialog')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Mark as sensitive' })).toBeVisible();
  },
};

export const Remove: Story = {
  args: { sensitive: true },
  play: async () => {
    await expect(await screen.findByRole('alertdialog')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Remove sensitive' })).toBeVisible();
  },
};

export const Offline: Story = {
  args: { offline: true },
  play: async () => {
    await expect(await screen.findByRole('alertdialog')).toBeVisible();
  },
};

export const Failed: Story = {
  args: {
    action: fn((): ReturnType<SetSensitiveAction> =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INTERNAL' as const, message: '' },
      }),
    ),
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as sensitive' }));
    await expect(await screen.findByText("Couldn't change this. Try again.")).toBeVisible();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
