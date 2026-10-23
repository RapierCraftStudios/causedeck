// The matters list's search, filters and sort (#388). The URL is the only state; the story renders
// the controls for a given list state against the mocked App Router.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { MatterFilters } from './matter-filters.tsx';

const meta = {
  title: 'Matters/MatterFilters',
  component: MatterFilters,
  args: {
    state: { sort: 'next_date' },
    slug: 'demo',
    owners: [
      { id: 'u-1', name: 'Meera Rao' },
      { id: 'u-2', name: 'Arjun Nair' },
    ],
    forums: [
      { id: 'f-1', name: 'Madras High Court' },
      { id: 'f-2', name: 'Karnataka High Court' },
    ],
  },
} satisfies Meta<typeof MatterFilters>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('searchbox')).toBeVisible();
  },
};

export const Filtered: Story = {
  args: { state: { sort: 'updated', status: 'active', q: 'Ilango', sensitive: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('searchbox')).toHaveValue('Ilango');
  },
};

export const NoOptions: Story = {
  args: { owners: [], forums: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('searchbox')).toBeVisible();
  },
};

export const Tamil: Story = {
  args: { state: { sort: 'next_date', q: 'இளங்கோ' } },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: { state: { sort: 'next_date', q: 'ಸುರೇಶ' } },
  globals: { locale: 'kn' },
};
