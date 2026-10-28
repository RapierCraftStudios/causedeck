// Precedent card (#903): a mine passage, a chamber-shared one, a retired one and read-only.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PrecedentCard } from './precedent-card.tsx';

const card = {
  itemId: 'i1',
  text: 'It is therefore most respectfully prayed that this Hon’ble Court may be pleased to issue a writ of mandamus.',
  kind: 'prayer',
  courtId: null,
  language: 'en',
  sourceDraftVersionId: 'v1',
  anchorId: 'b1',
  status: 'active',
  scope: 'mine',
  lastUsedAt: '2026-03-04T05:00:00.000Z',
} as const;

const meta = { title: 'Memory/PrecedentCard', component: PrecedentCard } satisfies Meta<
  typeof PrecedentCard
>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mine: Story = { args: { card } };
export const Chamber: Story = { args: { card: { ...card, scope: 'chamber', lastUsedAt: null } } };
export const Retired: Story = { args: { card: { ...card, status: 'retired' } } };
export const ReadOnly: Story = { args: { card, readOnly: true } };
