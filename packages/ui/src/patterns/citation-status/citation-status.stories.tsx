// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid (static, non-interactive label)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { CITATION_STATUS_ORDER, CitationStatus } from './citation-status';

const meta = {
  title: 'Patterns/CitationStatus',
  component: CitationStatus,
  args: { status: 'verified' },
  argTypes: { status: { control: 'select', options: CITATION_STATUS_ORDER } },
} satisfies Meta<typeof CitationStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Verified').parentElement).toHaveAttribute(
      'data-status',
      'verified',
    );
  },
};

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {CITATION_STATUS_ORDER.map((status) => (
        <CitationStatus key={status} status={status} />
      ))}
    </div>
  ),
};

export const LongText: Story = {
  args: { status: 'not_found', label: 'Not found in the reported judgments of this court' },
  decorators: [
    (Story) => (
      <div className="max-w-40">
        <Story />
      </div>
    ),
  ],
};
