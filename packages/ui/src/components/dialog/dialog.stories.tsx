// check-stories: n/a Invalid (a dialog holds no value of its own; field validation lives in form controls)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarClock } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { LONG_DESCRIPTION, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

interface ExampleProps extends ComponentProps<typeof Dialog> {
  trigger?: string;
  title?: string;
  description?: string;
  saving?: boolean;
  disabled?: boolean;
  icon?: boolean;
  content?: Omit<ComponentProps<typeof DialogContent>, 'children'>;
  cancel?: string;
  confirm?: string;
}

function Example({
  trigger = 'Reschedule hearing',
  title = 'Reschedule hearing',
  description = `Pick the next date for ${MATTER_TITLE}.`,
  saving = false,
  disabled = false,
  icon = false,
  content,
  cancel = 'Cancel',
  confirm = 'Save changes',
  ...props
}: ExampleProps) {
  return (
    <Dialog {...props}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {icon ? <CalendarClock aria-hidden="true" /> : null}
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent {...content}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{cancel}</Button>
          </DialogClose>
          <Button loading={saving}>{confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const meta = {
  title: 'Components/Dialog',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;
type Canvas = Parameters<NonNullable<Story['play']>>[0]['canvas'];

const page = () => within(document.body);

async function openWithClick(canvas: Canvas, name = 'Reschedule hearing') {
  await userEvent.click(canvas.getByRole('button', { name }));
  return page().findByRole('dialog');
}

export const Default: Story = {
  play: async ({ canvas }) => {
    const dialog = await openWithClick(canvas);
    await expect(dialog).toHaveAccessibleName('Reschedule hearing');
    await expect(dialog).toHaveAccessibleDescription(`Pick the next date for ${MATTER_TITLE}.`);
    await expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  },
};

/** Keyboard: focus moves in, Tab and Shift+Tab stay inside, Esc closes, focus returns. */
export const KeyboardFocusTrap: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Reschedule hearing' });
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const dialog = await page().findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Cancel, Save changes, Close: tabbing past the last wraps to the first, and back.
    const focusable = within(dialog).getAllByRole('button');
    for (let i = 0; i < focusable.length * 2; i += 1) {
      await userEvent.tab();
      await expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < focusable.length * 2; i += 1) {
      await userEvent.tab({ shift: true });
      await expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());
    await expect(trigger).toHaveFocus();
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button');
    await userEvent.hover(trigger);
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
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
    const dialog = await openWithClick(canvas);
    const save = within(dialog).getByRole('button', { name: 'Save changes Loading' });
    await expect(save).toHaveAttribute('aria-busy', 'true');
  },
};

export const WithIcon: Story = {
  args: { icon: true },
  play: async ({ canvas }) => {
    await openWithClick(canvas);
  },
};

export const LongText: Story = {
  args: { title: MATTER_TITLE, description: LONG_DESCRIPTION },
  play: async ({ canvas }) => {
    const dialog = await openWithClick(canvas);
    // max-w-lg (512 px) caps the width whatever the copy.
    await expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(512);
  },
};

/** Bottom sheet layout (what phones under 768 px get): handle, 16 px top radius. */
export const MobileSheet: Story = {
  args: { content: { layout: 'sheet' } },
  play: async ({ canvas }) => {
    const dialog = await openWithClick(canvas);
    await expect(dialog).toHaveAttribute('data-layout', 'sheet');
    await expect(getComputedStyle(dialog).borderTopLeftRadius).toBe('16px');
  },
};

export const RtlNeutral: Story = {
  args: { content: { dir: 'rtl' } },
  play: async ({ canvas }) => {
    const dialog = await openWithClick(canvas);
    const close = within(dialog).getByRole('button', { name: 'Close' });
    // The close button sits at the inline end: the left edge in RTL.
    await expect(close.getBoundingClientRect().left).toBeLessThan(
      dialog.getBoundingClientRect().left + dialog.getBoundingClientRect().width / 2,
    );
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    trigger: OVERLAY_INDIC[lang].open,
    title: OVERLAY_INDIC[lang].title,
    description: OVERLAY_INDIC[lang].description,
    cancel: OVERLAY_INDIC[lang].cancel,
    confirm: OVERLAY_INDIC[lang].confirm,
    content: { lang, labels: { close: OVERLAY_INDIC[lang].close } },
  },
  play: async ({ canvas }) => {
    const dialog = await openWithClick(canvas, OVERLAY_INDIC[lang].open);
    await expect(
      within(dialog).getByRole('button', { name: OVERLAY_INDIC[lang].close }),
    ).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
