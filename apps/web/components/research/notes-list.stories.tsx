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

export const Empty: Story = { args: base };
export const Loading: Story = { args: { ...base, state: 'loading' } };
export const ErrorState: Story = { args: { ...base, state: 'error' } };
export const Denied: Story = { args: { ...base, state: 'denied' } };
