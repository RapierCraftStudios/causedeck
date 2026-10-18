// check-stories: n/a Hover, FocusVisible, Active, Disabled, WithIcon (a read-only indicator: not interactive)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';

import { Button } from '../button/button';
import { INDIC, LONG_LABEL } from '../__fixtures__/labels';
import { Progress, type ProgressProps } from './progress';

function Labelled({ label, hint, ...props }: ProgressProps & { label: string; hint?: string }) {
  return (
    <div className="text-ink grid w-72 gap-2 font-sans text-sm">
      <div className="flex justify-between gap-3">
        <span id="progress-label" className="truncate">
          {label}
        </span>
        {hint === undefined ? null : <span className="text-ink-muted shrink-0">{hint}</span>}
      </div>
      <Progress aria-labelledby="progress-label" {...props} />
    </div>
  );
}

const meta = {
  title: 'Components/Progress',
  component: Progress,
  args: { value: 40 },
  render: (args) => <Labelled label="Uploading vakalatnama" hint="40%" {...args} />,
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('progressbar', { name: 'Uploading vakalatnama' });
    await expect(bar).toHaveAttribute('aria-valuenow', '40');
    const indicator = bar.firstElementChild;
    await expect(indicator?.getBoundingClientRect().width).toBeCloseTo(
      bar.getBoundingClientRect().width * 0.4,
      0,
    );
  },
};

/** Width transitions use --dur-base; under reduced motion the change is instant. */
export const Animated: Story = {
  render: () => {
    function Demo() {
      const [value, setValue] = useState(20);
      return (
        <div className="grid gap-3">
          <Labelled label="Indexing documents" value={value} />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setValue((v) => Math.min(100, v + 20));
            }}
          >
            Advance
          </Button>
        </div>
      );
    }
    return <Demo />;
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Advance' }));
    await expect(canvas.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  },
};

export const Loading: Story = {
  args: { value: null },
  render: (args) => <Labelled label="Preparing index" {...args} />,
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-busy', 'true');
    await expect(bar).toHaveAttribute('data-state', 'indeterminate');
  },
};

export const Invalid: Story = {
  args: { value: 65, tone: 'danger' },
  render: (args) => <Labelled label="Upload failed at 65%" hint="Try again" {...args} />,
};

export const Complete: Story = {
  args: { value: 100, tone: 'success' },
  render: (args) => <Labelled label="Upload complete" hint="100%" {...args} />,
};

export const LongText: Story = {
  render: (args) => <Labelled label={LONG_LABEL} hint="40%" {...args} />,
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl">
      <Labelled label="Uploading vakalatnama" hint="40%" {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('progressbar');
    const indicator = bar.firstElementChild;
    // The fill starts at the inline start (the right edge in RTL).
    await expect(Math.round(indicator?.getBoundingClientRect().right ?? 0)).toBe(
      Math.round(bar.getBoundingClientRect().right),
    );
  },
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta">
      <Labelled label={INDIC.ta.upload} hint="40%" {...args} />
    </div>
  ),
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn">
      <Labelled label={INDIC.kn.upload} hint="40%" {...args} />
    </div>
  ),
};
