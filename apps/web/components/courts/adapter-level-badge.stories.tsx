// Adapter level badge (#399): A0 and A1 with their capability sentence; levels not yet offered
// (A2, A3) render nothing.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { AdapterLevelBadge } from './adapter-level-badge.tsx';

const meta = {
  title: 'Courts/AdapterLevelBadge',
  component: AdapterLevelBadge,
  args: { level: 'A1' },
  argTypes: { level: { control: 'inline-radio', options: ['A0', 'A1', 'A2', 'A3'] } },
} satisfies Meta<typeof AdapterLevelBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const A1: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-adapter-level="A1"]')).not.toBeNull();
  },
};

export const A0: Story = { args: { level: 'A0' } };

export const WithDescription: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <AdapterLevelBadge level="A0" withDescription />
      <AdapterLevelBadge level="A1" withDescription />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelectorAll('[data-slot="adapter-level-description"]'),
    ).toHaveLength(2);
  },
};

/** A2 and A3 are not offered yet: nothing renders. */
export const NotShown: Story = {
  args: { level: 'A2' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-adapter-level]')).toBeNull();
  },
};

export const Tamil: Story = {
  args: { level: 'A1', withDescription: true },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: { level: 'A0', withDescription: true },
  globals: { locale: 'kn' },
};
