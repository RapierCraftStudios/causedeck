// Research notes list (#80): empty, loading, error and permission-denied states.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { NotesList } from './notes-list.tsx';

const ok = () => Promise.resolve({ ok: true });
const actions = {
  create: ok,
  update: ok,
  remove: ok,
  addAuthority: ok,
  removeAuthority: ok,
  pinAuthority: ok,
};
const base = { workspaceId: 'w', matterId: 'm', notes: [], actions };

const meta = { title: 'Research/NotesList', component: NotesList } satisfies Meta<typeof NotesList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotesEmpty: Story = { args: base };
export const NotesLoading: Story = { args: { ...base, state: 'loading' } };
export const NotesErrorState: Story = { args: { ...base, state: 'error' } };
export const NotesDenied: Story = { args: { ...base, state: 'denied' } };
