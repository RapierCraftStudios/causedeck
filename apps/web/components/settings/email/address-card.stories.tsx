// The email intake address card (#54): empty, with an address (Copy, Rotate, Revoke) and the flag
// off. The actions are stubs that answer with a fresh address.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { AddressCard } from './address-card.tsx';

const ADDRESS = {
  id: 'addr-1',
  address: 'u-k3j9x2mq4a@intake.causedeck.test',
  createdAt: new Date('2026-10-01T10:00:00Z'),
};
const ok =
  <T,>(data: T) =>
  () =>
    Promise.resolve({ ok: true as const, data });

const meta = {
  title: 'Settings/Email/AddressCard',
  component: AddressCard,
  args: {
    workspaceId: 'ws-1',
    address: ADDRESS,
    enabled: true,
    create: ok(ADDRESS),
    rotate: ok(ADDRESS),
    revoke: ok({ addressId: ADDRESS.id }),
  },
} satisfies Meta<typeof AddressCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithAddress: Story = {};

export const Empty: Story = { args: { address: null } };

export const NotEnabled: Story = { args: { enabled: false } };

export const Tamil: Story = { globals: { locale: 'ta' } };
