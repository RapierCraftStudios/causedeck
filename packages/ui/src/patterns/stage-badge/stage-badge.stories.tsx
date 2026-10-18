// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid (static, non-interactive label)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { PATTERN_INDIC } from '../__fixtures__/trust';
import { PatternSkeleton } from '../states/loading-skeletons';
import { LISTING_STAGES, PROCEEDING_STAGES } from '../types';
import { StageBadge } from './stage-badge';
import { STAGE_ORDER } from './stage-map';

const meta = {
  title: 'Patterns/StageBadge',
  component: StageBadge,
  args: { stage: 'defects' },
  argTypes: { stage: { control: 'select', options: STAGE_ORDER } },
} satisfies Meta<typeof StageBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Defects').parentElement).toHaveAttribute(
      'data-stage',
      'defects',
    );
  },
};

/** Proceeding stages, then listing stages. */
export const AllStages: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {PROCEEDING_STAGES.map((stage) => (
          <StageBadge key={stage} stage={stage} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {LISTING_STAGES.map((stage) => (
          <StageBadge key={stage} stage={stage} />
        ))}
      </div>
    </div>
  ),
};

export const WithIcon: Story = {
  args: { stage: 'numbered' },
};

export const LongText: Story = {
  args: { stage: 're_presented', label: 'Re-presented after curing office objections' },
  decorators: [
    (Story) => (
      <div className="max-w-40">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    const badge = canvas.getByText(/Re-presented/).parentElement;
    await expect(badge?.getBoundingClientRect().width).toBeLessThanOrEqual(160);
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

export const Tamil: Story = {
  render: () => (
    <div lang="ta" className="flex gap-2">
      <StageBadge stage="filed" label={PATTERN_INDIC.ta.filed} />
      <StageBadge stage="listed" label={PATTERN_INDIC.ta.listed} />
    </div>
  ),
};

export const Kannada: Story = {
  render: () => (
    <div lang="kn" className="flex gap-2">
      <StageBadge stage="filed" label={PATTERN_INDIC.kn.filed} />
      <StageBadge stage="listed" label={PATTERN_INDIC.kn.listed} />
    </div>
  ),
};

/** The 22 px placeholder while the matter loads. */
export const Loading: Story = {
  render: () => <PatternSkeleton pattern="stage-badge" />,
};
