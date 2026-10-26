// Person form (#393): add or edit a person of the matter, with contact fields for clients and
// professionals only. Tamil and Kannada stories carry party names in their own scripts.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen } from 'storybook/test';

import { PersonForm, type PersonFormInitial } from './person-form.tsx';

const action = fn(() =>
  Promise.resolve({
    ok: true as const,
    data: { id: '00000000-0000-4000-8000-0000000b0001', name: 'Saved' },
  }),
);

const meta = {
  title: 'Matters/PersonForm',
  component: PersonForm,
  args: {
    workspaceId: '00000000-0000-4000-8000-00000000a001',
    matterId: '00000000-0000-4000-8000-0000000a1001',
    action,
    open: true,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof PersonForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const client: PersonFormInitial = {
  id: '00000000-0000-4000-8000-0000000b0002',
  name: 'Ilango (fictional)',
  aliases: ['A. Ilango', 'Ilango A.'],
  kind: 'client',
  contact: { email: 'ilango@example.test', phone: '+91 90000 00000', address: null },
};

export const Add: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
  },
};

export const Edit: Story = {
  args: { person: client },
  play: async () => {
    await expect(await screen.findByDisplayValue('Ilango (fictional)')).toBeVisible();
  },
};

export const Offline: Story = {
  args: { offline: true },
  play: async () => {
    await expect(await screen.findByRole('dialog')).toBeVisible();
  },
};

export const Tamil: Story = {
  args: {
    person: {
      ...client,
      name: 'இளங்கோ (கற்பனை)',
      aliases: ['ஏ. இளங்கோ'],
    },
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    person: {
      ...client,
      name: 'ಇಳಂಗೋ (ಕಾಲ್ಪನಿಕ)',
      aliases: ['ಎ. ಇಳಂಗೋ'],
    },
  },
  globals: { locale: 'kn' },
};
