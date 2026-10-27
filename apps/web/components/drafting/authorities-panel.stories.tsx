// The studio's Pinned authorities panel (#782). Fictional data only.
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { AuthoritiesPanel, type PinnedAuthority } from './authorities-panel.tsx';

const authorities: PinnedAuthority[] = [
  { id: 'n1.0', label: 'Example v. Sample (fictional)', citation: '2024 SCC OnLine Mad 1234' },
  { id: 'n1.1', label: 'Sample Traders v. Union (fictional)' },
];

const meta = {
  title: 'Drafting/AuthoritiesPanel',
  component: AuthoritiesPanel,
  args: { authorities, selectedSlot: 'b.0', onInsert: fn() },
} satisfies Meta<typeof AuthoritiesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithAuthorities: Story = {};
export const Empty: Story = { args: { authorities: [] } };
export const NoBlockSelected: Story = { args: { selectedSlot: undefined } };
export const AuthoritiesDisabled: Story = { args: { disabled: true } };
