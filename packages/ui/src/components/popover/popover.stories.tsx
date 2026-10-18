// check-stories: n/a Invalid (a popover holds no value of its own; field validation lives in form controls)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarClock } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { LONG_DESCRIPTION, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './popover';

interface ExampleProps extends ComponentProps<typeof Popover> {
  trigger?: string;
  title?: string;
  body?: string;
  done?: string;
  saving?: boolean;
  disabled?: boolean;
  icon?: boolean;
  content?: Omit<ComponentProps<typeof PopoverContent>, 'children'>;
}

function Example({
  trigger = 'Next hearing',
  title = 'Next hearing',
  body = `14 Nov 2026, Court 12, item 34 in ${MATTER_TITLE}.`,
  done = 'Done',
  saving = false,
  disabled = false,
  icon = false,
  content,
  ...props
}: ExampleProps) {
  return (
    <Popover {...props}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {icon ? <CalendarClock aria-hidden="true" /> : null}
          {trigger}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-labelledby="popover-title" {...content}>
        <div className="flex flex-col gap-3">
          <p id="popover-title" className="text-ink font-medium">
            {title}
          </p>
          <p className="text-ink-muted">{body}</p>
          <PopoverClose asChild>
            <Button size="sm" variant="secondary" loading={saving} className="self-end">
              {done}
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const meta = {
  title: 'Components/Popover',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;
type Canvas = Parameters<NonNullable<Story['play']>>[0]['canvas'];

const page = () => within(document.body);
const settled = (el: Element) => Promise.all(el.getAnimations().map((a) => a.finished));

async function open(canvas: Canvas, name = 'Next hearing') {
  await userEvent.click(canvas.getByRole('button', { name }));
  return page().findByRole('dialog');
}

export const Default: Story = {
  play: async ({ canvas }) => {
    const popover = await open(canvas);
    await expect(popover).toHaveAccessibleName('Next hearing');
    await expect(popover).toHaveAttribute('data-slot', 'popover-content');
    await settled(popover);
    // Opens 4 px below the trigger.
    const trigger = canvas.getByRole('button', { name: 'Next hearing' });
    await expect(
      Math.round(popover.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom),
    ).toBe(4);
  },
};

/** Keyboard: Enter opens and moves focus in, Esc closes and returns focus to the trigger. */
export const Keyboard: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Next hearing' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const popover = await page().findByRole('dialog');
    await waitFor(() => expect(popover.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());
    await expect(trigger).toHaveFocus();
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button');
    await userEvent.hover(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const trigger = canvas.getByRole('button');
    await expect(trigger).toHaveFocus();
    await expect(trigger.matches(':focus-visible')).toBe(true);
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: trigger },
      { keys: '[/MouseLeft]', target: trigger },
    ]);
    await expect(await page().findByRole('dialog')).toHaveAttribute('data-state', 'open');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button');
    await expect(trigger).toBeDisabled();
    await userEvent.click(trigger, { pointerEventsCheck: 0 });
    await expect(page().queryByRole('dialog')).toBeNull();
  },
};

export const Loading: Story = {
  args: { saving: true },
  play: async ({ canvas }) => {
    const popover = await open(canvas);
    await expect(within(popover).getByRole('button', { name: 'Done Loading' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  },
};

export const WithIcon: Story = {
  args: { icon: true },
  play: async ({ canvas }) => {
    await open(canvas);
  },
};

export const LongText: Story = {
  args: { title: MATTER_TITLE, body: LONG_DESCRIPTION },
  play: async ({ canvas }) => {
    const popover = await open(canvas);
    await settled(popover);
    // w-72: the panel wraps long copy at 288 px.
    await expect(Math.round(popover.getBoundingClientRect().width)).toBe(288);
  },
};

export const RtlNeutral: Story = {
  args: { content: { dir: 'rtl', align: 'start' } },
  render: (args) => (
    <div dir="rtl">
      <Example {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const popover = await open(canvas);
    await expect(popover).toHaveAttribute('dir', 'rtl');
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    trigger: OVERLAY_INDIC[lang].open,
    title: OVERLAY_INDIC[lang].title,
    body: OVERLAY_INDIC[lang].description,
    done: OVERLAY_INDIC[lang].close,
    content: { lang },
  },
  play: async ({ canvas }) => {
    const popover = await open(canvas, OVERLAY_INDIC[lang].open);
    await expect(popover).toHaveAccessibleName(OVERLAY_INDIC[lang].title);
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
