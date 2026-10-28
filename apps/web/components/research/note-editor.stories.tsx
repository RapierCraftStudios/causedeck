// Research note editor (#80): the new-note form and a note with one pinned authority.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { NoteEditor } from './note-editor.tsx';

const ok = () => Promise.resolve({ ok: true });
const actions = {
  create: ok,
  update: ok,
  remove: ok,
  addAuthority: ok,
  removeAuthority: ok,
  pinAuthority: ok,
};

const meta = { title: 'Research/NoteEditor', component: NoteEditor } satisfies Meta<typeof NoteEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewNote: Story = { args: { workspaceId: 'w', matterId: 'm', actions } };

export const WithAuthority: Story = {
  args: {
    workspaceId: 'w',
    matterId: 'm',
    actions,
    note: {
      id: 'n',
      title: 'Limitation under s. 34',
      body: 'Three months, extendable by thirty days.',
      authorities: [{ label: 'Associate Builders v DDA', citation: '(2015) 3 SCC 49', pinned: true }],
    },
  },
};
