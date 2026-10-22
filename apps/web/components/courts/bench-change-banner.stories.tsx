// Bench-change banner (#435): the open bench-change alerts with a link to each matter, a warning
// icon plus text; an alert with no previous bench and a bench with no judges recorded; the empty
// alerts panel; dark mode.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { benchChanges } from './__tests__/fixtures.ts';
import { BenchChangeBanner } from './bench-change-banner.tsx';

const meta = {
  title: 'Courts/BenchChangeBanner',
  component: BenchChangeBanner,
  args: { slug: 'demo', alerts: benchChanges() },
} satisfies Meta<typeof BenchChangeBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Raman v. State (fictional)' })).toHaveAttribute(
      'href',
      '/w/demo/matters/matter-1',
    );
  },
};

export const NoPreviousBench: Story = {
  args: { alerts: benchChanges().slice(1) },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No bench was recorded for it before.')).toBeVisible();
  },
};

export const EmptyPanel: Story = {
  args: { alerts: [], showEmpty: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No open bench changes.')).toBeVisible();
  },
};

export const Dark: Story = { globals: { theme: 'dark' } };

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
