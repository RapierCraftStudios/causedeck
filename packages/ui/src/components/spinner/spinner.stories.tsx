// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid, WithIcon, LongText (not interactive and renders no text)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { INDIC } from '../__fixtures__/labels';
import { Spinner } from './spinner';

const meta = {
  title: 'Components/Spinner',
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
    </div>
  ),
};

/** The spinner is the loading state; it inherits the surrounding text colour. */
export const Loading: Story = {
  render: () => (
    <p className="text-ink-muted flex items-center gap-2 text-sm">
      <Spinner decorative />
      Fetching cause list
    </p>
  ),
};

export const RtlNeutral: Story = {
  render: () => (
    <p dir="rtl" className="text-ink flex items-center gap-2 text-sm">
      <Spinner decorative />
      Fetching cause list
    </p>
  ),
};

export const Tamil: Story = {
  args: { labels: { loading: INDIC.ta.loading } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: INDIC.ta.loading })).toBeInTheDocument();
  },
};

export const Kannada: Story = {
  args: { labels: { loading: INDIC.kn.loading } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: INDIC.kn.loading })).toBeInTheDocument();
  },
};
