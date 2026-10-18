// check-stories: n/a Invalid (a confirmation holds no value of its own)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Archive } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { LONG_DESCRIPTION, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';

interface ExampleProps extends ComponentProps<typeof AlertDialog> {
  trigger?: string;
  title?: string;
  description?: string;
  cancel?: string;
  confirm?: string;
  disabled?: boolean;
  icon?: boolean;
  busy?: boolean;
  dir?: 'ltr' | 'rtl';
  lang?: string;
  onConfirm?: () => void;
}

function Example({
  trigger = 'Archive matter',
  title = 'Archive this matter?',
  description = `${MATTER_TITLE} moves to the archive. You can restore it later.`,
  cancel = 'Cancel',
  confirm = 'Archive',
  disabled = false,
  icon = false,
  busy = false,
  dir,
  lang,
  onConfirm,
  ...props
}: ExampleProps) {
  return (
    <AlertDialog {...props}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={disabled}>
          {icon ? <Archive aria-hidden="true" /> : null}
          {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir={dir} lang={lang} aria-busy={busy || undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onConfirm}>
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const meta = {
  title: 'Components/AlertDialog',
  component: Example,
  args: { onConfirm: fn() },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;
type Canvas = Parameters<NonNullable<Story['play']>>[0]['canvas'];

const page = () => within(document.body);

async function open(canvas: Canvas, name = 'Archive matter') {
  await userEvent.click(canvas.getByRole('button', { name }));
  return page().findByRole('alertdialog');
}

export const Default: Story = {
  play: async ({ canvas, args }) => {
    const dialog = await open(canvas);
    await expect(dialog).toHaveAccessibleName('Archive this matter?');
    // Focus starts on Cancel, the safe choice.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(page().queryByRole('alertdialog')).toBeNull());
  },
};

/** Esc cancels and focus returns to the trigger; clicking outside does not dismiss. */
export const Keyboard: Story = {
  play: async ({ canvas, args }) => {
    const trigger = canvas.getByRole('button', { name: 'Archive matter' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const dialog = await page().findByRole('alertdialog');
    for (let i = 0; i < 4; i += 1) {
      await userEvent.tab();
      await expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('alertdialog')).toBeNull());
    await expect(trigger).toHaveFocus();
    await expect(args.onConfirm).not.toHaveBeenCalled();
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
    await expect(canvas.getByRole('button').matches(':focus-visible')).toBe(true);
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: trigger },
      { keys: '[/MouseLeft]', target: trigger },
    ]);
    await expect(await page().findByRole('alertdialog')).toHaveAttribute('data-state', 'open');
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button'), { pointerEventsCheck: 0 });
    await expect(page().queryByRole('alertdialog')).toBeNull();
  },
};

/** While the action runs the dialog is busy and the action is disabled. */
export const Loading: Story = {
  args: { busy: true },
  play: async ({ canvas }) => {
    const dialog = await open(canvas);
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(within(dialog).getByRole('button', { name: 'Archive' })).toBeDisabled();
  },
};

export const WithIcon: Story = {
  args: { icon: true },
  play: async ({ canvas }) => {
    await open(canvas);
  },
};

export const LongText: Story = {
  args: { title: `Archive ${MATTER_TITLE}?`, description: LONG_DESCRIPTION },
  play: async ({ canvas }) => {
    const dialog = await open(canvas);
    await expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(448);
  },
};

export const RtlNeutral: Story = {
  args: { dir: 'rtl' },
  play: async ({ canvas }) => {
    await expect(await open(canvas)).toHaveAttribute('dir', 'rtl');
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    lang,
    trigger: OVERLAY_INDIC[lang].open,
    title: OVERLAY_INDIC[lang].title,
    description: OVERLAY_INDIC[lang].description,
    cancel: OVERLAY_INDIC[lang].cancel,
    confirm: OVERLAY_INDIC[lang].confirm,
  },
  play: async ({ canvas }) => {
    const dialog = await open(canvas, OVERLAY_INDIC[lang].open);
    await expect(dialog).toHaveAccessibleName(OVERLAY_INDIC[lang].title);
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
