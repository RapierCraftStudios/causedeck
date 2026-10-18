// check-stories: n/a Invalid (a drawer holds no value of its own; field validation lives in form controls)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NotebookPen } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { LONG_DESCRIPTION, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';

type ExampleProps = ComponentProps<typeof Drawer> & {
  trigger?: string;
  title?: string;
  description?: string;
  cancel?: string;
  confirm?: string;
  disabled?: boolean;
  icon?: boolean;
  saving?: boolean;
  dir?: 'ltr' | 'rtl';
  lang?: string;
};

function Example({
  trigger = 'Add note',
  title = 'Add note',
  description = `Notes are saved to ${MATTER_TITLE}.`,
  cancel = 'Cancel',
  confirm = 'Save note',
  disabled = false,
  icon = false,
  saving = false,
  dir,
  lang,
  ...props
}: ExampleProps) {
  return (
    <Drawer {...props}>
      <DrawerTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {icon ? <NotebookPen aria-hidden="true" /> : null}
          {trigger}
        </Button>
      </DrawerTrigger>
      <DrawerContent dir={dir} lang={lang}>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button loading={saving}>{confirm}</Button>
          <DrawerClose asChild>
            <Button variant="secondary">{cancel}</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

const meta = {
  title: 'Components/Drawer',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;
type Canvas = Parameters<NonNullable<Story['play']>>[0]['canvas'];

const page = () => within(document.body);
const settled = (el: Element) => Promise.all(el.getAnimations().map((a) => a.finished));

async function open(canvas: Canvas, name = 'Add note') {
  await userEvent.click(canvas.getByRole('button', { name }));
  return page().findByRole('dialog');
}

export const Default: Story = {
  play: async ({ canvas }) => {
    const drawer = await open(canvas);
    await expect(drawer).toHaveAccessibleName('Add note');
    await expect(drawer).toHaveAttribute('data-vaul-drawer-direction', 'bottom');
    await settled(drawer);
    await expect(Math.round(drawer.getBoundingClientRect().bottom)).toBe(window.innerHeight);
    await expect(getComputedStyle(drawer).borderTopLeftRadius).toBe('16px');
    await expect(drawer.querySelector('[data-slot="sheet-handle"]')).toBeVisible();
  },
};

/** Esc closes and focus returns to the trigger; Tab stays inside. */
export const Keyboard: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Add note' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const drawer = await page().findByRole('dialog');
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 4; i += 1) {
      await userEvent.tab();
      await expect(drawer.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** vaul's 0.5 s slide is replaced by the 250 ms sheet token. */
export const TokenMotion: Story = {
  play: async ({ canvas }) => {
    const drawer = await open(canvas);
    await expect(getComputedStyle(drawer).animationDuration).toBe('0.25s');
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
    await expect(await page().findByRole('dialog')).toHaveAttribute('data-state', 'open');
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button'), { pointerEventsCheck: 0 });
    await expect(page().queryByRole('dialog')).toBeNull();
  },
};

export const Loading: Story = {
  args: { saving: true },
  play: async ({ canvas }) => {
    const drawer = await open(canvas);
    await expect(within(drawer).getByRole('button', { name: 'Save note Loading' })).toHaveAttribute(
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
  args: { title: MATTER_TITLE, description: LONG_DESCRIPTION },
  play: async ({ canvas }) => {
    const drawer = await open(canvas);
    await expect(drawer.getBoundingClientRect().height).toBeLessThanOrEqual(
      window.innerHeight * 0.85 + 1,
    );
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
    await expect(await open(canvas, OVERLAY_INDIC[lang].open)).toHaveAccessibleName(
      OVERLAY_INDIC[lang].title,
    );
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
