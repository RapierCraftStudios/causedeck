// check-stories: n/a Loading, Invalid (a menubar has no pending or invalid state of its own)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarPlus, FileText, FolderOpen, StickyNote } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { screen } from 'storybook/test';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { formatHotkeyLabel } from '../../hooks/use-hotkey';
import { MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from './menubar';

interface ExampleProps extends ComponentProps<typeof Menubar> {
  menus?: readonly [string, string, string];
  items?: readonly string[];
  icons?: boolean;
  disabledMenu?: boolean;
  lang?: string;
}

function Example({
  menus = ['Matter', 'View', 'Help'],
  items = ['Open matter', 'Add hearing', 'Add note'],
  icons = false,
  disabledMenu = false,
  lang,
  ...props
}: ExampleProps) {
  const icon = [FolderOpen, CalendarPlus, StickyNote];
  return (
    <Menubar lang={lang} {...props}>
      <MenubarMenu>
        <MenubarTrigger>
          {icons ? <FileText aria-hidden="true" /> : null}
          {menus[0]}
        </MenubarTrigger>
        <MenubarContent lang={lang}>
          {items.map((item, i) => {
            const Icon = icon[i] ?? FolderOpen;
            return (
              <MenubarItem key={item}>
                {icons ? <Icon aria-hidden="true" /> : null}
                {item}
                {i === 0 ? (
                  <MenubarShortcut>{formatHotkeyLabel('mod+o', false)}</MenubarShortcut>
                ) : null}
              </MenubarItem>
            );
          })}
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Export</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem>Cause list (PDF)</MenubarItem>
              <MenubarItem>Hearing history (CSV)</MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem variant="destructive">Archive matter</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>{menus[1]}</MenubarTrigger>
        <MenubarContent lang={lang}>
          <MenubarLabel>Density</MenubarLabel>
          <MenubarRadioGroup value="comfortable">
            <MenubarRadioItem value="comfortable">Comfortable</MenubarRadioItem>
            <MenubarRadioItem value="compact">Compact</MenubarRadioItem>
          </MenubarRadioGroup>
          <MenubarSeparator />
          <MenubarCheckboxItem checked>Show disposed matters</MenubarCheckboxItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger disabled={disabledMenu}>{menus[2]}</MenubarTrigger>
        <MenubarContent lang={lang}>
          <MenubarItem>Keyboard shortcuts</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

const meta = {
  title: 'Components/Menubar',
  component: Example,
  render: (args, { id }) => <Example key={id} {...args} />,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** The story canvas (only the query the helper needs). */
type Canvas = Pick<typeof screen, 'getByRole'>;

async function open(canvas: Canvas, name = 'Matter') {
  await userEvent.click(canvas.getByRole('menuitem', { name }));
  return page().findByRole('menu');
}

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('menubar')).toBeInTheDocument();
    const menu = await open(canvas);
    await expect(within(menu).getByRole('menuitem', { name: /Open matter/ })).toBeInTheDocument();
  },
};

/** Keyboard: arrows move between menus and items, Esc closes and returns focus to the trigger. */
export const KeyboardNavigation: Story = {
  play: async ({ canvas }) => {
    const matter = canvas.getByRole('menuitem', { name: 'Matter' });
    const view = canvas.getByRole('menuitem', { name: 'View' });
    await userEvent.tab();
    await expect(matter).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(view).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(matter).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    const menu = await page().findByRole('menu');
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    const items = within(menu).getAllByRole('menuitem');
    await waitFor(() => expect(items[0]).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull());
    await expect(matter).toHaveFocus();
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    const item = within(menu).getByRole('menuitem', { name: /Add hearing/ });
    await userEvent.hover(item);
    await expect(item).toHaveAttribute('data-highlighted');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const trigger = canvas.getByRole('menuitem', { name: 'Matter' });
    await expect(trigger.matches(':focus-visible')).toBe(true);
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('menuitem', { name: 'Matter' });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: trigger },
      { keys: '[/MouseLeft]', target: trigger },
    ]);
    await expect(trigger).toHaveAttribute('data-state', 'open');
  },
};

export const Disabled: Story = {
  args: { disabledMenu: true },
  play: async ({ canvas }) => {
    const help = canvas.getByRole('menuitem', { name: 'Help' });
    await expect(help).toBeDisabled();
    await userEvent.click(help, { pointerEventsCheck: 0 });
    await expect(page().queryByRole('menu')).toBeNull();
  },
};

export const WithIcon: Story = {
  args: { icons: true },
  play: async ({ canvas }) => {
    await open(canvas);
  },
};

export const LongText: Story = {
  args: { items: [MATTER_TITLE, `Copy cause-list entry for ${MATTER_TITLE}`] },
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(menu.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const RtlNeutral: Story = {
  args: { dir: 'rtl' },
  render: (args, { id }) => (
    <div dir="rtl">
      <Example key={id} {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const matter = canvas.getByRole('menuitem', { name: 'Matter' });
    const view = canvas.getByRole('menuitem', { name: 'View' });
    // In RTL the first menu sits on the right and ArrowLeft moves forward.
    await expect(matter.getBoundingClientRect().left).toBeGreaterThan(
      view.getBoundingClientRect().left,
    );
    await userEvent.tab();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(view).toHaveFocus();
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    lang,
    menus: [OVERLAY_INDIC[lang].matters, OVERLAY_INDIC[lang].tabs[1], OVERLAY_INDIC[lang].tabs[2]],
    items: OVERLAY_INDIC[lang].actions,
  },
  play: async ({ canvas }) => {
    const menu = await open(canvas, OVERLAY_INDIC[lang].matters);
    await expect(
      within(menu).getByRole('menuitem', { name: new RegExp(OVERLAY_INDIC[lang].actions[0]) }),
    ).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
