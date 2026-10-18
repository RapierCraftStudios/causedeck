// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid (a static surface; interactive content brings its own states)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarDays, MoreHorizontal } from 'lucide-react';
import { expect } from 'storybook/test';

import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { IconButton } from '../icon-button/icon-button';
import { Skeleton, SkeletonGroup } from '../skeleton/skeleton';
import { INDIC, LONG_LABEL, MATTER_TITLE } from '../__fixtures__/labels';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card';

const meta = {
  title: 'Components/Card',
  component: Card,
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

function MatterCard({
  title,
  meta: metaLine,
  hearing,
}: {
  title: string;
  meta: string;
  hearing: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{metaLine}</CardDescription>
        <CardAction>
          <IconButton label="Matter actions" size="sm">
            <MoreHorizontal />
          </IconButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Badge tone="info">{hearing}</Badge>
      </CardContent>
      <CardFooter>
        <Button size="sm">Open matter</Button>
        <Button size="sm" variant="ghost">
          Add note
        </Button>
      </CardFooter>
    </Card>
  );
}

export const Default: Story = {
  render: () => (
    <MatterCard
      title={MATTER_TITLE}
      meta="W.P. 4521 of 2026 · Madras High Court"
      hearing="14 Nov 2026"
    />
  ),
  play: async ({ canvas }) => {
    const title = canvas.getByRole('heading', { name: MATTER_TITLE });
    await expect(getComputedStyle(title).fontFamily).toMatch(/Newsreader/);
    const card = title.closest('[data-slot="card"]');
    if (!card) throw new Error('no card');
    await expect(getComputedStyle(card).borderTopLeftRadius).toBe('12px');
    await expect(getComputedStyle(card).boxShadow).toBe('none');
  },
};

export const Loading: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <SkeletonGroup>
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </SkeletonGroup>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-16 w-full" />
      </CardContent>
    </Card>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" className="text-ink-muted size-5" />
          Hearings this week
        </CardTitle>
        <CardDescription>3 listed, 1 part-heard</CardDescription>
      </CardHeader>
      <CardContent className="text-ink-muted text-sm">Tue 14 Nov · Court 12 · Item 34</CardContent>
    </Card>
  ),
};

export const LongText: Story = {
  render: () => <MatterCard title={LONG_LABEL} meta={LONG_LABEL} hearing="14 Nov 2026" />,
  play: async ({ canvas }) => {
    const card = canvas.getByRole('heading').closest('[data-slot="card"]');
    await expect(card?.getBoundingClientRect().width).toBeLessThanOrEqual(384);
  },
};

export const RtlNeutral: Story = {
  render: () => (
    <div dir="rtl">
      <MatterCard title={MATTER_TITLE} meta="W.P. 4521 of 2026" hearing="14 Nov 2026" />
    </div>
  ),
};

export const Tamil: Story = {
  render: () => (
    <div lang="ta">
      <MatterCard title={INDIC.ta.upload} meta={INDIC.ta.hearing} hearing={INDIC.ta.filed} />
    </div>
  ),
};

export const Kannada: Story = {
  render: () => (
    <div lang="kn">
      <MatterCard title={INDIC.kn.upload} meta={INDIC.kn.hearing} hearing={INDIC.kn.filed} />
    </div>
  ),
};
