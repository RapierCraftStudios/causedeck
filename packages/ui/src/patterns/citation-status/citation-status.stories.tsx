// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid (static, non-interactive label)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { StageBadgeSkeleton } from '../states/loading-skeletons';
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

export const WithIcon: Story = {
  args: { status: 'not_found' },
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

export const Tamil: Story = {
  render: () => (
    <div lang="ta" className="flex gap-2">
      <CitationStatus status="verified" label="சரிபார்க்கப்பட்டது" />
      <CitationStatus status="not_found" label="கிடைக்கவில்லை" />
      <CitationStatus status="unknown" label="தெரியவில்லை" />
    </div>
  ),
};

export const Kannada: Story = {
  render: () => (
    <div lang="kn" className="flex gap-2">
      <CitationStatus status="verified" label="ಪರಿಶೀಲಿಸಲಾಗಿದೆ" />
      <CitationStatus status="not_found" label="ಸಿಗಲಿಲ್ಲ" />
      <CitationStatus status="unknown" label="ತಿಳಿದಿಲ್ಲ" />
    </div>
  ),
};

/** The capsule-sized placeholder while the check runs. */
export const Loading: Story = {
  render: () => <StageBadgeSkeleton />,
};
