// check-stories: n/a Active, Disabled, Loading, Invalid, WithIcon (a scroll container: no pressed, disabled or validation state)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor } from 'storybook/test';

import { Separator } from '../separator/separator';
import { INDIC, LONG_LABEL, MATTERS } from '../__fixtures__/labels';
import { ScrollArea } from './scroll-area';

function MatterList({ items = MATTERS }: { items?: readonly string[] }) {
  return (
    <ul className="text-ink p-3 font-sans text-sm">
      {items.map((matter, i) => (
        <li key={`${matter}-${String(i)}`}>
          {i > 0 ? <Separator className="my-2" /> : null}
          {matter}
        </li>
      ))}
    </ul>
  );
}

const meta = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  args: { label: 'Matters', className: 'border-line h-48 w-72 rounded-md border' },
  render: (args) => (
    <ScrollArea {...args}>
      <MatterList />
    </ScrollArea>
  ),
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const region = canvas.getByRole('region', { name: 'Matters' });
    await expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
  },
};

/** Scrollbars appear on hover (Radix `type="hover"`). */
export const Hover: Story = {
  play: async ({ canvas, canvasElement }) => {
    await userEvent.hover(canvas.getByRole('region'));
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-slot="scroll-area-thumb"]')).not.toBeNull(),
    );
  },
};

/** Keyboard: Tab focuses the viewport (visible ring); the browser then scrolls it with the arrow keys. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    const region = canvas.getByRole('region', { name: 'Matters' });
    await userEvent.tab();
    await expect(region).toHaveFocus();
    await expect(region.matches(':focus-visible')).toBe(true);
    await expect(getComputedStyle(region).outlineStyle).toBe('solid');
  },
};

export const Horizontal: Story = {
  args: {
    orientation: 'horizontal',
    label: 'Hearing dates',
    className: 'w-72 border-line rounded-md border',
  },
  render: (args) => (
    <ScrollArea {...args}>
      <div className="text-ink flex w-max gap-3 p-3 font-sans text-sm">
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} className="border-line rounded-md border px-3 py-2">
            {`${String(i + 1).padStart(2, '0')} Nov 2026`}
          </span>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const LongText: Story = {
  render: (args) => (
    <ScrollArea {...args}>
      <MatterList items={Array.from({ length: 6 }, () => LONG_LABEL)} />
    </ScrollArea>
  ),
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl">
      <ScrollArea {...args}>
        <MatterList />
      </ScrollArea>
    </div>
  ),
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta">
      <ScrollArea {...args} label={INDIC.ta.noMatters}>
        <MatterList items={Object.values(INDIC.ta)} />
      </ScrollArea>
    </div>
  ),
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn">
      <ScrollArea {...args} label={INDIC.kn.noMatters}>
        <MatterList items={Object.values(INDIC.kn)} />
      </ScrollArea>
    </div>
  ),
};
