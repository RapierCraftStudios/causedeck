// Contact list (#849, #82 part 3): populated, filtered-empty, empty (writer and read-only),
// offline, the keyboard shortcuts (n, / and Esc) and Tamil/Kannada names. The action is mocked.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import type { ContactRowView } from '../../../../../../lib/people/people-deps.ts';
import type { Result } from '../../../../../../lib/safe-action.ts';
import { ContactList } from './contact-list.tsx';

type CreateAction = (input: unknown) => Promise<Result<{ id: string; personId: string }>>;

const row = (n: number, personName: string, over: Partial<ContactRowView> = {}): ContactRowView => {
  const id = `00000000-0000-4000-8000-0000000c00${String(n).padStart(2, '0')}`;
  return {
    id,
    href: `/w/chennai-solo/people/${id}`,
    personName,
    kind: 'primary',
    languagePref: 'en',
    phone: '+919840000001',
    email: null,
    linkedCount: 1,
    unlinked: false,
    archived: false,
    redacted: false,
    ...over,
  };
};

const CONTACTS = [
  row(1, 'Ilango Murugesan', { languagePref: 'ta', linkedCount: 2 }),
  row(2, 'Meera Iyer', { kind: 'accounts', email: 'meera@example.e2e.test', phone: null }),
  row(3, 'Fictional Trading Co', { kind: 'instructing', linkedCount: 0, unlinked: true }),
];

const meta = {
  title: 'People/ContactList',
  component: ContactList,
  args: {
    slug: 'chennai-solo',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    contacts: CONTACTS,
    q: '',
    kind: undefined,
    language: undefined,
    canWrite: true,
    createAction: fn<CreateAction>(() =>
      Promise.resolve({ ok: true, data: { id: 'c', personId: 'p' } }),
    ),
  },
} satisfies Meta<typeof ContactList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('link')).toHaveLength(3);
    await expect(canvas.getByText('Not linked to a matter')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'New contact' })).toBeEnabled();
  },
};

/** A clerk or viewer: no New contact button at all. */
export const ReadOnly: Story = {
  args: { canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'New contact' })).toBeNull();
  },
};

export const Empty: Story = {
  args: { contacts: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No contacts yet')).toBeVisible();
  },
};

export const EmptyReadOnly: Story = {
  args: { contacts: [], canWrite: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No contacts yet')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'New contact' })).toBeNull();
  },
};

export const FilteredEmpty: Story = {
  args: { contacts: [], q: 'zzz' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No contacts match these filters')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Clear filters' })).toBeVisible();
  },
};

export const Offline: Story = {
  args: { forceOffline: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'New contact' })).toBeDisabled();
    await expect(canvas.getAllByRole('link')).toHaveLength(3);
  },
};

/** `n` opens the form; `Esc` closes it. */
export const NewShortcut: Story = {
  play: async () => {
    await userEvent.keyboard('n');
    await expect(await screen.findByRole('dialog')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect(screen.queryByRole('dialog')).toBeNull();
  },
};

/** `/` focuses the search; `Esc` leaves it. */
export const SearchShortcut: Story = {
  play: async ({ canvas }) => {
    await userEvent.keyboard('/');
    await expect(canvas.getByRole('searchbox')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByRole('searchbox')).not.toHaveFocus();
  },
};

/** `j` moves onto the first row. */
export const RowNavigation: Story = {
  play: async ({ canvas }) => {
    await userEvent.keyboard('j');
    await expect(canvas.getByRole('link', { name: 'Open Ilango Murugesan' })).toHaveFocus();
  },
};

export const Tamil: Story = {
  args: { contacts: [row(4, 'முருகன் இளங்கோவன்', { languagePref: 'ta' })] },
  globals: { locale: 'ta' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('முருகன் இளங்கோவன்')).toBeVisible();
  },
};

export const Kannada: Story = {
  args: { contacts: [row(5, 'ಕಾವೇರಿ ಗೌಡ', { languagePref: 'kn' })] },
  globals: { locale: 'kn' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('ಕಾವೇರಿ ಗೌಡ')).toBeVisible();
  },
};
