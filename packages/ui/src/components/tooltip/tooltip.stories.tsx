// check-stories: n/a Loading, Invalid (a tooltip only describes its trigger; it has no busy or invalid state)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Archive, CalendarClock } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { LONG_DESCRIPTION, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

interface ExampleProps extends ComponentProps<typeof Tooltip> {
  trigger?: string;
  tip?: string;
  disabled?: boolean;
  icon?: boolean;
  content?: Omit<ComponentProps<typeof TooltipContent>, 'children'>;
}

function Example({
  trigger = 'Reschedule',
  tip = 'Move the hearing to the next listed date',
  disabled = false,
  icon = false,
  content,
  ...props
}: ExampleProps) {
  const button = (
    <Button variant="outline" disabled={disabled}>
      {icon ? <CalendarClock aria-hidden="true" /> : null}
      {trigger}
    </Button>
  );
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild>
        {/* A disabled button gets no pointer or focus events: wrap it so the tip stays reachable. */}
        {disabled ? (
          <span tabIndex={0} className="inline-flex rounded-md">
            {button}
          </span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent {...content}>{tip}</TooltipContent>
    </Tooltip>
  );
}

const meta = {
  title: 'Components/Tooltip',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const settled = (el: Element) => Promise.all(el.getAnimations().map((a) => a.finished));

const visibleContent = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

export const Default: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button', { name: 'Reschedule' }));
    const tip = await page().findByRole('tooltip');
    await expect(tip).toHaveTextContent('Move the hearing to the next listed date');
    await expect(canvas.getByRole('button', { name: 'Reschedule' })).toHaveAccessibleDescription(
      'Move the hearing to the next listed date',
    );
    await expect(tip.id).not.toBe('');
  },
};

/** Keyboard: focusing the trigger shows the tooltip at once; Esc hides it. */
export const Keyboard: Story = {
  play: async () => {
    await userEvent.tab();
    await page().findByRole('tooltip');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('tooltip')).toBeNull());
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button'));
    await page().findByRole('tooltip');
    const content = visibleContent();
    await expect(content?.dataset['state']).toMatch(/open/);
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const button = canvas.getByRole('button');
    await expect(button.matches(':focus-visible')).toBe(true);
    await page().findByRole('tooltip');
  },
};

/** Pressing the trigger dismisses the tooltip so it never covers the result of the click. */
export const Active: Story = {
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button');
    await userEvent.hover(button);
    await page().findByRole('tooltip');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: button },
      { keys: '[/MouseLeft]', target: button },
    ]);
    await waitFor(() => expect(page().queryByRole('tooltip')).toBeNull());
  },
};

/** A disabled control still explains itself: the wrapper takes focus and hover. */
export const Disabled: Story = {
  args: { disabled: true, tip: 'Archived matters cannot be rescheduled' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toBeDisabled();
    await userEvent.tab();
    await expect(await page().findByRole('tooltip')).toHaveTextContent(
      'Archived matters cannot be rescheduled',
    );
  },
};

export const WithIcon: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" aria-label="Archive matter" className="size-9 px-0">
          <Archive aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Archive matter</TooltipContent>
    </Tooltip>
  ),
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button', { name: 'Archive matter' }));
    await page().findByRole('tooltip');
  },
};

export const LongText: Story = {
  args: { tip: LONG_DESCRIPTION },
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button'));
    await page().findByRole('tooltip');
    const content = visibleContent();
    if (!content) throw new Error('tooltip content missing');
    await settled(content);
    // max-w-xs caps the bubble at 320 px; long copy wraps.
    await expect(content.getBoundingClientRect().width).toBeLessThanOrEqual(320);
  },
};

export const RtlNeutral: Story = {
  args: { content: { dir: 'rtl', side: 'right' } },
  render: (args) => (
    <div dir="rtl">
      <Example {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button'));
    await page().findByRole('tooltip');
    await expect(visibleContent()).toHaveAttribute('dir', 'rtl');
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    trigger: OVERLAY_INDIC[lang].open,
    tip: OVERLAY_INDIC[lang].description,
    content: { lang },
  },
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByRole('button', { name: OVERLAY_INDIC[lang].open }));
    await expect(await page().findByRole('tooltip')).toHaveTextContent(
      OVERLAY_INDIC[lang].description,
    );
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
