// The sender allow-list card (#54): empty and with court, e-filing and self entries.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { AllowlistCard } from './allowlist-card.tsx';

const ENTRIES = [
  {
    id: 'e1',
    pattern: 'court.gov.in',
    kind: 'court',
    label: 'High Court',
    isDomain: true,
    createdAt: new Date('2026-10-01T10:00:00Z'),
  },
  {
    id: 'e2',
    pattern: 'clerk@efiling.example.in',
    kind: 'efiling',
    label: null,
    isDomain: false,
    createdAt: new Date('2026-10-01T10:00:00Z'),
  },
];

const FIRST = {
  id: 'e1',
  pattern: 'court.gov.in',
  kind: 'court',
  label: 'High Court',
  isDomain: true,
  createdAt: new Date('2026-10-01T10:00:00Z'),
};

const meta = {
  title: 'Settings/Email/AllowlistCard',
  component: AllowlistCard,
  args: {
    workspaceId: 'ws-1',
    entries: ENTRIES,
    enabled: true,
    add: () => Promise.resolve({ ok: true as const, data: FIRST }),
    remove: () => Promise.resolve({ ok: true as const, data: { entryId: 'e1' } }),
  },
} satisfies Meta<typeof AllowlistCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithEntries: Story = {};

export const Empty: Story = { args: { entries: [] } };

export const NotEnabled: Story = { args: { enabled: false } };

export const Kannada: Story = { globals: { locale: 'kn' } };
