// check-stories: n/a Invalid (a menu holds no value of its own to validate)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Archive, CalendarPlus, FolderOpen, MoreHorizontal, StickyNote } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { screen } from 'storybook/test';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { formatHotkeyLabel } from '../../hooks/use-hotkey';
import { MATTER_ACTIONS, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import { Button } from '../button/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './dropdown-menu';

const ICONS = { open: FolderOpen, hearing: CalendarPlus, note: StickyNote, archive: Archive };

interface ExampleProps extends ComponentProps<typeof DropdownMenu> {
  trigger?: string;
  items?: readonly string[];
  icons?: boolean;
  loading?: boolean;
  disabled?: boolean;
  disabledItem?: boolean;
  label?: string;
  content?: Omit<ComponentProps<typeof DropdownMenuContent>, 'children'>;
}

function Example({
  trigger = 'Matter actions',
  items,
  icons = false,
  loading = false,
  disabled = false,
  disabledItem = false,
  label = 'Matter',
  content,
  ...props
}: ExampleProps) {
  return (
    <DropdownMenu {...props}>
      <DropdownMenuTrigger asChild disabled={disabled || loading}>
        <Button variant="outline" disabled={disabled} loading={loading}>
          {icons ? <MoreHorizontal aria-hidden="true" /> : null}
          {trigger}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...content}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuGroup>
          {items
            ? items.map((item) => <DropdownMenuItem key={item}>{item}</DropdownMenuItem>)
            : MATTER_ACTIONS.map((action) => {
                const Icon = ICONS[action.id];
                return (
                  <DropdownMenuItem
                    key={action.id}
                    variant={action.id === 'archive' ? 'destructive' : 'default'}
                    disabled={disabledItem && action.id === 'note'}
                  >
                    {icons ? <Icon aria-hidden="true" /> : null}
                    {action.label}
                    {'shortcut' in action ? (
                      <DropdownMenuShortcut>
                        {formatHotkeyLabel(action.shortcut, false)}
                      </DropdownMenuShortcut>
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked>Show on Court-Day Board</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta = {
  title: 'Components/DropdownMenu',
  component: Example,
  // Remount per story so open state never leaks from the previous story.
  render: (args, { id }) => <Example key={id} {...args} />,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** The story canvas (only the query the helper needs). */
type Canvas = Pick<typeof screen, 'getByRole'>;

async function open(canvas: Canvas, name = 'Matter actions') {
  await userEvent.click(canvas.getByRole('button', { name }));
  return page().findByRole('menu');
}

export const Default: Story = {
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(within(menu).getAllByRole('menuitem')).toHaveLength(MATTER_ACTIONS.length);
    await expect(within(menu).getByRole('menuitemcheckbox')).toBeChecked();
  },
};

/** Keyboard: Enter opens, arrows move, typeahead jumps, Esc closes and returns focus. */
export const KeyboardNavigation: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button', { name: 'Matter actions' });
    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const menu = await page().findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    const [first, second] = items;
    if (!first || !second) throw new Error('expected menu items');
    await waitFor(() => expect(first).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await expect(second).toHaveFocus();
    await expect(second).toHaveAttribute('data-highlighted');
    await userEvent.keyboard('{ArrowUp}');
    await expect(first).toHaveFocus();

    // Typeahead: "ar" jumps to "Archive matter".
    await userEvent.keyboard('ar');
    await expect(within(menu).getByRole('menuitem', { name: 'Archive matter' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull());
    await expect(trigger).toHaveFocus();
  },
};

/** Touch widths: a bottom sheet list docked to the viewport edge. */
export const TouchSheet: Story = {
  args: { content: { layout: 'sheet' } },
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await Promise.all(menu.getAnimations().map((a) => a.finished));
    await expect(menu).toHaveAttribute('data-layout', 'sheet');
    const box = menu.getBoundingClientRect();
    await expect(Math.round(box.bottom)).toBe(window.innerHeight);
    await expect(Math.round(box.width)).toBe(document.documentElement.clientWidth);
    await expect(getComputedStyle(menu).borderTopLeftRadius).toBe('16px');
    for (const item of within(menu).getAllByRole('menuitem')) {
      await expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    // Same keyboard semantics as the popover menu.
    await userEvent.keyboard('{ArrowDown}');
    await expect(menu.contains(document.activeElement)).toBe(true);
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
    await expect(await page().findByRole('menu')).toHaveAttribute('data-state', 'open');
  },
};

export const Disabled: Story = {
  args: { disabledItem: true },
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(within(menu).getByRole('menuitem', { name: /Add note/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};

export const DisabledTrigger: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('button');
    await expect(trigger).toBeDisabled();
    await userEvent.click(trigger, { pointerEventsCheck: 0 });
    await expect(page().queryByRole('menu')).toBeNull();
  },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  },
};

export const WithIcon: Story = {
  args: { icons: true },
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(menu.querySelectorAll('svg').length).toBeGreaterThan(0);
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
  args: { dir: 'rtl', icons: true },
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(menu).toHaveAttribute('dir', 'rtl');
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    trigger: OVERLAY_INDIC[lang].open,
    label: OVERLAY_INDIC[lang].matters,
    items: OVERLAY_INDIC[lang].actions,
    content: { lang },
  },
  play: async ({ canvas }) => {
    const menu = await open(canvas, OVERLAY_INDIC[lang].open);
    await expect(
      within(menu).getByRole('menuitem', { name: OVERLAY_INDIC[lang].actions[0] }),
    ).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
