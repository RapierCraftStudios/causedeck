// Roster forum picker (#435): a forum `Select` below 768 px and a 240 px rail of forum links from
// 768 px, the selected forum marked `aria-current="page"`.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { rosterForums } from './__tests__/fixtures.ts';
import { RosterForumPicker } from './roster-forum-picker.tsx';

const meta = {
  title: 'Courts/RosterForumPicker',
  component: RosterForumPicker,
  args: { slug: 'demo', forums: rosterForums(), selected: 'in.tn.madras-hc.principal.appellate' },
} satisfies Meta<typeof RosterForumPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-current="page"]')).toHaveAttribute(
      'data-roster-forum',
      'in.tn.madras-hc.principal.appellate',
    );
  },
};

export const SingleForum: Story = { args: { forums: rosterForums().slice(0, 1) } };

export const Dark: Story = { globals: { theme: 'dark' } };

export const Tamil: Story = { globals: { locale: 'ta' } };
