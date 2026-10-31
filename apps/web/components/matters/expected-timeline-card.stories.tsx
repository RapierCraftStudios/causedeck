// Expected timeline card (#655): median time to first listing and to disposal of the workspace's own
// matters in the same forum and case type; a withheld figure reads `Not enough data`.
import type { MatterExpectedTimeline } from '@causedeck/intelligence';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ExpectedTimelineCard } from './expected-timeline-card.tsx';

const timeline: MatterExpectedTimeline = {
  minCell: 5,
  forums: [{ id: 'f-1', court: 'Madras High Court' }],
  timelines: [
    {
      forumId: 'f-1',
      caseTypeCode: 'WP',
      stage: 'admission',
      byStage: true,
      listingDelayDays: { value: 23, n: 14 },
      disposalDays: { value: 412, n: 9 },
      withheld: false,
    },
  ],
};

const meta = {
  title: 'Matters/ExpectedTimelineCard',
  component: ExpectedTimelineCard,
  args: { timeline },
} satisfies Meta<typeof ExpectedTimelineCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Withheld: Story = {
  args: {
    timeline: {
      ...timeline,
      timelines: [
        {
          ...timeline.timelines[0]!,
          byStage: false,
          listingDelayDays: { value: null, n: null },
          disposalDays: { value: null, n: null },
          withheld: true,
        },
      ],
    },
  },
};
