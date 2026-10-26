// Contact card (#849, #82 part 3): the list row with kind, language, details and the linked matter
// count. Linked, unlinked, archived, redacted (clerk) and Tamil/Kannada name samples.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import type { ContactRowView } from '../../../../../../lib/people/people-deps.ts';
import { ContactCard } from './contact-card.tsx';

const CONTACT: ContactRowView = {
  id: '00000000-0000-4000-8000-0000000c0001',
  href: '/w/chennai-solo/people/00000000-0000-4000-8000-0000000c0001',
  personName: 'Ilango Murugesan',
  kind: 'primary',
  languagePref: 'ta',
  phone: '+919840000001',
  email: 'ilango@example.e2e.test',
  linkedCount: 2,
  unlinked: false,
  archived: false,
  redacted: false,
};

const meta = {
  title: 'People/ContactCard',
  component: ContactCard,
  args: { contact: CONTACT },
} satisfies Meta<typeof ContactCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Ilango Murugesan')).toBeVisible();
    await expect(canvas.getByText('2 linked matters')).toBeVisible();
    await expect(canvas.queryByText('Not linked to a matter')).toBeNull();
  },
};

export const ActiveContact: Story = {
  args: { active: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link')).toHaveAttribute('data-active');
  },
};

/** The flag carries its words, never colour alone. */
export const Unlinked: Story = {
  args: { contact: { ...CONTACT, linkedCount: 0, unlinked: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Not linked to a matter')).toBeVisible();
    await expect(canvas.getByText('No linked matters')).toBeVisible();
  },
};

export const Archived: Story = {
  args: { contact: { ...CONTACT, archived: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Archived')).toBeVisible();
  },
};

/** A clerk: phone and email are hidden. */
export const RedactedContact: Story = {
  args: { contact: { ...CONTACT, phone: null, email: null, redacted: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Phone and email are hidden for your role')).toBeVisible();
  },
};

export const NoDetails: Story = {
  args: { contact: { ...CONTACT, phone: null, email: null } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No phone or email')).toBeVisible();
  },
};

export const Tamil: Story = {
  args: { contact: { ...CONTACT, personName: 'முருகன் இளங்கோவன்', languagePref: 'ta' } },
  globals: { locale: 'ta' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('முருகன் இளங்கோவன்')).toBeVisible();
  },
};

export const Kannada: Story = {
  args: { contact: { ...CONTACT, personName: 'ಕಾವೇರಿ ಗೌಡ', languagePref: 'kn' } },
  globals: { locale: 'kn' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('ಕಾವೇರಿ ಗೌಡ')).toBeVisible();
  },
};
