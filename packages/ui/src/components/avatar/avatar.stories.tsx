// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid, WithIcon (static image, not interactive)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { INDIC, PEOPLE } from '../__fixtures__/labels';
import { Avatar } from './avatar';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  args: { name: PEOPLE.advocate },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] } },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: PEOPLE.advocate })).toHaveTextContent('MR');
  },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Avatar {...args} size="sm" />
      <Avatar {...args} size="md" />
      <Avatar {...args} size="lg" />
    </div>
  ),
  play: async ({ canvas }) => {
    const sizes = canvas
      .getAllByRole('img')
      .map((img) => img.parentElement?.getBoundingClientRect().width);
    await expect(sizes).toEqual([24, 32, 40]);
  },
};

/** While the photo loads (or if it fails) the initials show. */
export const Loading: Story = {
  args: { src: '/never-loads.jpg' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('img', { name: PEOPLE.advocate })).toHaveTextContent('MR');
  },
};

export const Group: Story = {
  render: () => (
    <div className="flex -space-x-2">
      {[PEOPLE.advocate, PEOPLE.junior, PEOPLE.clerk].map((name) => (
        <Avatar key={name} name={name} className="ring-surface ring-2" />
      ))}
    </div>
  ),
};

export const LongText: Story = {
  args: { name: PEOPLE.long, size: 'lg' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: PEOPLE.long })).toHaveTextContent('VS');
  },
};

export const RtlNeutral: Story = {
  render: () => (
    <div dir="rtl" className="flex -space-x-2 rtl:space-x-reverse">
      <Avatar name={PEOPLE.advocate} />
      <Avatar name={PEOPLE.junior} />
    </div>
  ),
};

export const Tamil: Story = {
  args: { name: INDIC.ta.person, size: 'lg' },
  render: (args) => (
    <div lang="ta">
      <Avatar {...args} />
    </div>
  ),
};

export const Kannada: Story = {
  args: { name: INDIC.kn.person, size: 'lg' },
  render: (args) => (
    <div lang="kn">
      <Avatar {...args} />
    </div>
  ),
};
