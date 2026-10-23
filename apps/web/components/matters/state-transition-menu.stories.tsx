// State transition menu (#392): the legal next states of a proceeding as a menu, with a confirm
// dialog that asks for the registry's number, a reopen reason or a cure deadline where needed.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { StateTransitionMenu } from './state-transition-menu.tsx';

const meta = {
  title: 'Matters/StateTransitionMenu',
  component: StateTransitionMenu,
  args: {
    workspaceId: '00000000-0000-4000-8000-00000000a001',
    proceedingId: '00000000-0000-4000-8000-0000000c1001',
    label: 'WP 1234/2025',
    state: 'filed',
    transitions: ['sr_fr', 'disposed'],
    action: fn(() => Promise.resolve({ ok: true as const, data: null })),
  },
} satisfies Meta<typeof StateTransitionMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('button', { name: 'Change state of WP 1234/2025' }),
    ).toBeVisible();
  },
};

export const MenuOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Change state of WP 1234/2025' }));
    await expect(await screen.findByRole('menu')).toBeVisible();
  },
};

export const ConfirmDialog: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Change state of WP 1234/2025' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Disposed' }));
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};

export const NumberRequired: Story = {
  args: { state: 'sr_fr', transitions: ['numbered'] },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Change state of WP 1234/2025' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Numbered' }));
    await expect(await screen.findByLabelText(/^Number/)).toBeVisible();
    await expect(screen.getByLabelText(/^Year/)).toBeVisible();
  },
};

export const ReopenReason: Story = {
  args: { state: 'disposed', transitions: ['numbered'] },
};

export const Offline: Story = {
  args: { offline: true },
};

export const NoTransitions: Story = {
  args: { transitions: [] },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};

export const Tamil: Story = {
  args: { label: 'ரிட் மனு 1234/2025' },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: { label: 'ರಿಟ್ ಅರ್ಜಿ 1234/2025' },
  globals: { locale: 'kn' },
};
