// The matter header (#390): title, client chips, status, owner and the sensitive lock badge; owners
// and advocates get the matter menu with the sensitive toggle.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';

import { MatterHeader } from './matter-header.tsx';

const meta = {
  title: 'Matters/MatterHeader',
  component: MatterHeader,
  args: {
    matter: {
      id: 'm-1',
      title: 'Ilango v. Fictional Housing Board',
      status: 'active',
      sensitive: false,
      owner: 'Meera Rao',
      clients: [{ id: 'c-1', name: 'Ilango' }],
    },
    workspaceId: 'ws-1',
    listHref: '/w/demo/matters',
    canRestrict: true,
    setSensitiveAction: fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { id: 'm-1', sensitive: true },
      }),
    ),
  },
} satisfies Meta<typeof MatterHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Owner: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Matter actions' })).toBeVisible();
  },
};

export const Sensitive: Story = {
  args: { matter: { ...meta.args.matter, sensitive: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Sensitive')).toBeVisible();
  },
};

export const ReadOnly: Story = {
  args: { canRestrict: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Matter actions' })).toBeNull();
  },
};

export const NoOwnerNoClients: Story = {
  args: { matter: { ...meta.args.matter, owner: null, clients: [], status: 'disposed' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No owner')).toBeVisible();
  },
};

export const LongTitle: Story = {
  args: {
    matter: {
      ...meta.args.matter,
      title:
        'Ilango and 14 others v. The Fictional Housing Board represented by its Secretary and the State of Tamil Nadu',
      status: 'archived',
    },
  },
};

export const Tamil: Story = {
  args: {
    matter: {
      ...meta.args.matter,
      title: 'இளங்கோ எதிர் தமிழ்நாடு வீட்டுவசதி வாரியம் (கற்பனை)',
      owner: 'மீரா ராவ்',
      clients: [{ id: 'c-1', name: 'இளங்கோ' }],
    },
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    matter: {
      ...meta.args.matter,
      title: 'ಸುರೇಶ ವಿರುದ್ಧ ಕಾಲ್ಪನಿಕ ನಗರಾಭಿವೃದ್ಧಿ ಪ್ರಾಧಿಕಾರ',
      owner: 'ಮೀರಾ ರಾವ್',
      clients: [{ id: 'c-1', name: 'ಸುರೇಶ' }],
    },
  },
  globals: { locale: 'kn' },
};
