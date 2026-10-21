// Courts area header (#399): the index title and description, or a forum's name with a breadcrumb
// back to the index (#400).
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Link from 'next/link';
import { expect } from 'storybook/test';

import { CourtNav } from './court-nav.tsx';

const meta = {
  title: 'Courts/CourtNav',
  component: CourtNav,
} satisfies Meta<typeof CourtNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Index: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(canvas.queryByRole('navigation')).toBeNull();
  },
};

export const ForumPage: Story = {
  args: {
    back: (
      <Link
        href="/w/demo/courts"
        className="text-accent text-sm underline-offset-2 hover:underline"
      >
        Courts
      </Link>
    ),
    title: 'Madras High Court, Principal Seat, Appellate Side',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Courts' })).toBeVisible();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
