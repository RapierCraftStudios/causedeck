// Adapter status card (#400): adapter id, active version, level (with the levels help popover),
// last verified, health across workspaces and this workspace's newest parse.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen, waitFor } from 'storybook/test';

import { adapterStatus } from './__tests__/fixtures.ts';
import { AdapterStatusCard } from './adapter-status-card.tsx';

const at = new Date('2026-10-21T04:00:00Z');

const meta = {
  title: 'Courts/AdapterStatusCard',
  component: AdapterStatusCard,
  args: { status: adapterStatus() },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AdapterStatusCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  args: {
    status: adapterStatus({
      health: 'ok',
      lastParse: { at, status: 'ok', rowsParsed: 120, rowsAnchored: 14, hallsUnreadable: [] },
    }),
  },
};

export const Degraded: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-adapter-status]')).not.toBeNull();
  },
};

export const Failed: Story = {
  args: {
    status: adapterStatus({
      health: 'failed',
      lastParse: { at, status: 'failed', rowsParsed: 0, rowsAnchored: 0, hallsUnreadable: [] },
    }),
  },
};

/** No active version, never verified, no runs anywhere. */
export const NeverRun: Story = {
  args: {
    status: adapterStatus({
      activeVersion: null,
      level: null,
      lastVerifiedAt: null,
      health: null,
      lastParse: null,
    }),
  },
};

export const LevelsHelpOpen: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const trigger = canvasElement.querySelector<HTMLElement>('[data-adapter-levels-trigger]');
    await expect(trigger).not.toBeNull();
    if (trigger) await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible());
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
