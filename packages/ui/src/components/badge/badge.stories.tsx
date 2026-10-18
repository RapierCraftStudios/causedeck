// check-stories: n/a Hover, FocusVisible, Active, Disabled, Loading, Invalid (static, non-interactive label)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CircleCheck, Clock } from 'lucide-react';
import { expect } from 'storybook/test';

import { INDIC, LONG_LABEL } from '../__fixtures__/labels';
import { Badge, type BadgeTone } from './badge';

const TONES: BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'outline'];

const meta = {
  title: 'Components/Badge',
  component: Badge,
  args: { children: 'Listed' },
  argTypes: { tone: { control: 'inline-radio', options: TONES } },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Listed')).toHaveAttribute('data-tone', 'neutral');
  },
};

export const Tones: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {TONES.map((tone) => (
        <Badge key={tone} {...args} tone={tone}>
          {tone}
        </Badge>
      ))}
    </div>
  ),
};

/** A badge rendered as a link keeps the focus ring. */
export const AsLink: Story = {
  render: (args) => (
    <Badge {...args} asChild tone="accent">
      <a href="#listed">Listed today</a>
    </Badge>
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Listed today' });
    link.focus();
    await expect(link).toHaveAttribute('data-slot', 'badge');
  },
};

export const WithIcon: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Badge {...args} tone="success">
        <CircleCheck aria-hidden="true" />
        Filed
      </Badge>
      <Badge {...args} tone="warning">
        <Clock aria-hidden="true" />
        Due in 3 days
      </Badge>
    </div>
  ),
};

export const LongText: Story = {
  render: (args) => (
    <div className="max-w-60">
      <Badge {...args}>
        <span className="truncate">{LONG_LABEL}</span>
      </Badge>
    </div>
  ),
  play: async ({ canvas }) => {
    const badge = canvas.getByText(LONG_LABEL).parentElement;
    await expect(badge?.getBoundingClientRect().width).toBeLessThanOrEqual(240);
  },
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl" className="flex items-center gap-2">
      <Badge {...args} tone="success">
        <CircleCheck aria-hidden="true" />
        Filed
      </Badge>
    </div>
  ),
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta" className="flex items-center gap-2">
      <Badge {...args} tone="success">
        {INDIC.ta.filed}
      </Badge>
      <Badge {...args} tone="info">
        {INDIC.ta.hearing}
      </Badge>
    </div>
  ),
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn" className="flex items-center gap-2">
      <Badge {...args} tone="success">
        {INDIC.kn.filed}
      </Badge>
      <Badge {...args} tone="info">
        {INDIC.kn.hearing}
      </Badge>
    </div>
  ),
};
