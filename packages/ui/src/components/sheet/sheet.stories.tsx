// check-stories: n/a Invalid (a sheet holds no value of its own; field validation lives in form controls)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SlidersHorizontal } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { LONG_DESCRIPTION, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  type SheetSide,
} from './sheet';

interface ExampleProps extends ComponentProps<typeof Sheet> {
  side?: SheetSide;
  trigger?: string;
  title?: string;
  description?: string;
  saving?: boolean;
  disabled?: boolean;
  icon?: boolean;
  content?: Omit<ComponentProps<typeof SheetContent>, 'children' | 'side'>;
  cancel?: string;
  confirm?: string;
}

function Example({
  side = 'end',
  trigger = 'Filters',
  title = 'Filter matters',
  description = 'Narrow the list by court, stage and next date.',
  saving = false,
  disabled = false,
  icon = false,
  content,
  cancel = 'Cancel',
  confirm = 'Apply filters',
  ...props
}: ExampleProps) {
  return (
    <Sheet {...props}>
      <SheetTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {icon ? <SlidersHorizontal aria-hidden="true" /> : null}
          {trigger}
        </Button>
      </SheetTrigger>
      <SheetContent side={side} {...content}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="secondary">{cancel}</Button>
          </SheetClose>
          <Button loading={saving}>{confirm}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const meta = {
  title: 'Components/Sheet',
  component: Example,
  argTypes: { side: { control: 'inline-radio', options: ['end', 'start', 'bottom'] } },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;
type Canvas = Parameters<NonNullable<Story['play']>>[0]['canvas'];

const page = () => within(document.body);

/** Wait for the slide-in to finish before measuring. */
const settled = (el: Element) => Promise.all(el.getAnimations().map((a) => a.finished));

async function open(canvas: Canvas, name = 'Filters') {
  await userEvent.click(canvas.getByRole('button', { name }));
  return page().findByRole('dialog');
}

export const Default: Story = {
  play: async ({ canvas }) => {
    const sheet = await open(canvas);
    await expect(sheet).toHaveAccessibleName('Filter matters');
    await expect(sheet).toHaveAttribute('data-side', 'end');
  },
};

export const Bottom: Story = {
  args: { side: 'bottom' },
  play: async ({ canvas }) => {
    const sheet = await open(canvas);
    await settled(sheet);
    const style = getComputedStyle(sheet);
    await expect(style.borderTopLeftRadius).toBe('16px');
    await expect(sheet.querySelector('[data-slot="sheet-handle"]')).not.toBeNull();
    await expect(Math.round(sheet.getBoundingClientRect().bottom)).toBe(window.innerHeight);
  },
};

export const Start: Story = {
  args: { side: 'start' },
  play: async ({ canvas }) => {
    const sheet = await open(canvas);
    await settled(sheet);
    await expect(Math.round(sheet.getBoundingClientRect().left)).toBe(0);
  },
};

/** Keyboard: focus is trapped inside, Esc closes and focus returns to the trigger. */
export const KeyboardFocusTrap: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Filters' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const sheet = await page().findByRole('dialog');
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      await expect(sheet.contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    await expect(sheet.contains(document.activeElement)).toBe(true);
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
    const sheet = await open(canvas);
    await expect(
      within(sheet).getByRole('button', { name: 'Apply filters Loading' }),
    ).toHaveAttribute('aria-busy', 'true');
  },
};

export const WithIcon: Story = {
  args: { icon: true },
  play: async ({ canvas }) => {
    await open(canvas);
  },
};

export const LongText: Story = {
  args: { title: MATTER_TITLE, description: LONG_DESCRIPTION },
  play: async ({ canvas }) => {
    const sheet = await open(canvas);
    await settled(sheet);
    await expect(Math.round(sheet.getBoundingClientRect().width)).toBeLessThanOrEqual(384);
  },
};

/** Logical sides: `end` is the left edge in RTL. */
export const RtlNeutral: Story = {
  args: { content: { dir: 'rtl' } },
  render: (args) => (
    <div dir="rtl">
      <Example {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const sheet = await open(canvas);
    await expect(sheet).toHaveAttribute('dir', 'rtl');
    await settled(sheet);
    await expect(Math.round(sheet.getBoundingClientRect().left)).toBe(0);
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    side: 'bottom',
    trigger: OVERLAY_INDIC[lang].open,
    title: OVERLAY_INDIC[lang].title,
    description: OVERLAY_INDIC[lang].description,
    cancel: OVERLAY_INDIC[lang].cancel,
    confirm: OVERLAY_INDIC[lang].confirm,
    content: { lang, labels: { close: OVERLAY_INDIC[lang].close } },
  },
  play: async ({ canvas }) => {
    const sheet = await open(canvas, OVERLAY_INDIC[lang].open);
    await expect(
      within(sheet).getByRole('button', { name: OVERLAY_INDIC[lang].close }),
    ).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
