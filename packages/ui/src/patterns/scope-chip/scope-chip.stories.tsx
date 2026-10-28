// check-stories: n/a Hover, FocusVisible, Active, Disabled, Loading, Invalid (static, non-interactive label)
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
export const Default: Story = OnlyYou;
export const WithIcon: Story = { args: { scope: 'workspace' } };
export const LongText: Story = {
  args: {
    scope: 'matter',
    labels: { matter: 'This matter only, not shared with the rest of the chamber' },
  },
};
export const RtlNeutral: Story = {
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};
export const Tamil: Story = { args: { scope: 'user', labels: { user: 'நீங்கள் மட்டும்' } } };
export const Kannada: Story = { args: { scope: 'user', labels: { user: 'ನೀವು ಮಾತ್ರ' } } };
