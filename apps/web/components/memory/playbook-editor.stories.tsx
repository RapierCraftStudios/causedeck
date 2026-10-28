// Playbook editor (#903): the empty form, one prefilled from a pending proposal, and read-only.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { PlaybookEditor } from './playbook-editor.tsx';

const meta = { title: 'Memory/PlaybookEditor', component: PlaybookEditor } satisfies Meta<
  typeof PlaybookEditor
>;

export default meta;
type Story = StoryObj<typeof meta>;

const onPropose = () => undefined;

export const Empty: Story = { args: { onPropose } };

export const Prefilled: Story = {
  args: {
    onPropose,
    initial: {
      name: 'Writ petition, High Court',
      courtId: null,
      format: 'writ_petition',
      standardPrayers: ['Issue a writ of mandamus', 'Grant such other relief as is just'],
      annexureOrder: ['Impugned order', 'Vakalatnama'],
    },
  },
};

export const ReadOnly: Story = { args: { onPropose, readOnly: true } };
