// Halls seen (#400): halls named in this workspace's lists for the forum, with the newest list's
// date and an unreadable tag; an empty state before any list.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { hallsSeen } from './__tests__/fixtures.ts';
import { HallsTable } from './halls-table.tsx';

const meta = {
  title: 'Courts/HallsTable',
  component: HallsTable,
  args: { halls: hallsSeen() },
} satisfies Meta<typeof HallsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table')).toBeVisible();
  },
};

export const AllReadable: Story = {
  args: { halls: hallsSeen().map((hall) => ({ ...hall, unreadable: false })) },
};

export const Empty: Story = {
  args: { halls: [] },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('table')).toBeNull();
  },
};

export const Tamil: Story = { globals: { locale: 'ta' } };

export const Kannada: Story = { globals: { locale: 'kn' } };
