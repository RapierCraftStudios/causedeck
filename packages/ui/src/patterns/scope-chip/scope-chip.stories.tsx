import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { ScopeChip } from './scope-chip';

const meta = {
  title: 'Patterns/ScopeChip',
  component: ScopeChip,
  args: { scope: 'user' },
} satisfies Meta<typeof ScopeChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnlyYou: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Only you')).toBeInTheDocument();
  },
};
export const Chamber: Story = { args: { scope: 'workspace' } };
export const ThisMatter: Story = { args: { scope: 'matter' } };
