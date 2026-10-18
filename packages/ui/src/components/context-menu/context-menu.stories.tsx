// check-stories: n/a Loading, Invalid (a context menu lists actions; it has no busy or invalid state)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Archive, CalendarPlus, FolderOpen, NotebookPen } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { formatHotkeyLabel } from '../../hooks/use-hotkey';
import { MATTER_ACTIONS, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu';

const ICONS = { open: FolderOpen, hearing: CalendarPlus, note: NotebookPen, archive: Archive };

interface ExampleProps extends ComponentProps<typeof ContextMenu> {
  area?: string;
  items?: readonly string[];
  icons?: boolean;
  disableArchive?: boolean;
  onSelect?: (id: string) => void;
  content?: Omit<ComponentProps<typeof ContextMenuContent>, 'children'>;
}

function Example({
  area = `Right-click ${MATTER_TITLE}`,
  items,
  icons = false,
  disableArchive = false,
  onSelect,
  content,
  ...props
}: ExampleProps) {
  return (
    <ContextMenu {...props}>
      <ContextMenuTrigger asChild>
        <div className="border-line-strong text-ink-muted flex h-32 w-80 items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm">
          {area}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent {...content}>
        {MATTER_ACTIONS.map((action, index) => {
          const Icon = ICONS[action.id];
          return (
            <ContextMenuItem
              key={action.id}
              disabled={disableArchive && action.id === 'archive'}
              variant={action.id === 'archive' ? 'destructive' : 'default'}
              onSelect={() => onSelect?.(action.id)}
            >
              {icons ? <Icon aria-hidden="true" /> : null}
              {items?.[index] ?? action.label}
              {'shortcut' in action ? (
                <ContextMenuShortcut>
                  {formatHotkeyLabel(action.shortcut, false)}
                </ContextMenuShortcut>
              ) : null}
            </ContextMenuItem>
          );
        })}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const meta = {
  title: 'Components/ContextMenu',
  component: Example,
  args: { onSelect: fn() },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;
type Canvas = Parameters<NonNullable<Story['play']>>[0]['canvas'];

const page = () => within(document.body);
const settled = (el: Element) => Promise.all(el.getAnimations().map((a) => a.finished));

async function open(canvas: Canvas) {
  const area = canvas.getByText(/./, { selector: '[data-slot="context-menu-trigger"]' });
  await userEvent.pointer({ keys: '[MouseRight]', target: area });
  return page().findByRole('menu');
}

export const Default: Story = {
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(within(menu).getAllByRole('menuitem')).toHaveLength(MATTER_ACTIONS.length);
    await expect(within(menu).getByRole('menuitem', { name: /Archive matter/ })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
  },
};

/** Keyboard: arrows move, typeahead jumps, Enter runs the item and closes, Esc closes. */
export const Keyboard: Story = {
  play: async ({ canvas, args }) => {
    const menu = await open(canvas);
    await userEvent.keyboard('{ArrowDown}');
    await expect(within(menu).getByRole('menuitem', { name: /Open matter/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(within(menu).getByRole('menuitem', { name: /Add hearing/ })).toHaveFocus();
    await userEvent.keyboard('ar');
    await expect(within(menu).getByRole('menuitem', { name: /Archive matter/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onSelect).toHaveBeenCalledWith('archive');
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull());

    await open(canvas);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('menu')).toBeNull());
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    const item = within(menu).getByRole('menuitem', { name: /Add note/ });
    await userEvent.hover(item);
    await waitFor(() => expect(item).toHaveAttribute('data-highlighted'));
  },
};

/** Keyboard focus inside the menu is shown by the highlighted row (and an outline in forced colours). */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await userEvent.keyboard('{ArrowDown}');
    const item = within(menu).getByRole('menuitem', { name: /Open matter/ });
    await expect(item).toHaveFocus();
    await expect(item).toHaveAttribute('data-highlighted');
  },
};

export const Active: Story = {
  play: async ({ canvas, args }) => {
    const menu = await open(canvas);
    const item = within(menu).getByRole('menuitem', { name: /Add hearing/ });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: item },
      { keys: '[/MouseLeft]', target: item },
    ]);
    await expect(args.onSelect).toHaveBeenCalledWith('hearing');
  },
};

export const Disabled: Story = {
  args: { disableArchive: true },
  play: async ({ canvas, args }) => {
    const menu = await open(canvas);
    const archive = within(menu).getByRole('menuitem', { name: /Archive matter/ });
    await expect(archive).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(archive, { pointerEventsCheck: 0 });
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const WithIcon: Story = {
  args: { icons: true },
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(menu.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  },
};

export const LongText: Story = {
  args: { items: [`Open ${MATTER_TITLE}`, 'Add hearing', 'Add note', 'Archive matter'] },
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await settled(menu);
    await expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  },
};

/** Checkbox and radio items, labels, groups and a submenu (ArrowRight opens, ArrowLeft closes). */
export const ItemKinds: Story = {
  render: function Render() {
    const [reminders, setReminders] = useState(true);
    const [view, setView] = useState('list');
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="border-line-strong text-ink-muted flex h-32 w-80 items-center justify-center rounded-lg border border-dashed text-sm">
            Right-click the cause list
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Cause list</ContextMenuLabel>
          <ContextMenuGroup>
            <ContextMenuCheckboxItem checked={reminders} onCheckedChange={setReminders}>
              Hearing reminders
            </ContextMenuCheckboxItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuRadioGroup value={view} onValueChange={setView}>
            <ContextMenuRadioItem value="list">List view</ContextMenuRadioItem>
            <ContextMenuRadioItem value="board">Board view</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to court</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem>Court 12</ContextMenuItem>
              <ContextMenuItem>Court 14</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.pointer({ keys: '[MouseRight]', target: canvas.getByText(/cause list/) });
    const menu = await page().findByRole('menu');
    const reminders = within(menu).getByRole('menuitemcheckbox', { name: 'Hearing reminders' });
    await expect(reminders).toHaveAttribute('aria-checked', 'true');
    await expect(within(menu).getByRole('menuitemradio', { name: 'List view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const sub = within(menu).getByRole('menuitem', { name: 'Move to court' });
    sub.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(page().getByRole('menuitem', { name: 'Court 12' })).toHaveFocus());
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(sub).toHaveFocus());
  },
};

export const RtlNeutral: Story = {
  args: { icons: true, dir: 'rtl' },
  render: (args) => (
    <div dir="rtl">
      <Example {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(menu).toHaveAttribute('dir', 'rtl');
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    area: OVERLAY_INDIC[lang].matters,
    items: [...OVERLAY_INDIC[lang].actions, OVERLAY_INDIC[lang].cancel],
    content: { lang },
  },
  play: async ({ canvas }) => {
    const menu = await open(canvas);
    await expect(
      within(menu).getByRole('menuitem', { name: new RegExp(OVERLAY_INDIC[lang].actions[0]) }),
    ).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
