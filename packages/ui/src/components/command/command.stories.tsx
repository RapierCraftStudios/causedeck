// check-stories: n/a Invalid (search input has no invalid state; an unmatched query shows the empty message)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Archive, CalendarPlus, FolderOpen, NotebookPen } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { useHotkey } from '../../hooks/use-hotkey';
import {
  MATTER_ACTIONS,
  MATTER_TITLE,
  OTHER_MATTER,
  OVERLAY_INDIC,
} from '../__fixtures__/overlays';
import { Button } from '../button/button';
import { Kbd } from '../kbd/kbd';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
  CommandShortcut,
  type CommandLabels,
} from './command';

const ICONS = { open: FolderOpen, hearing: CalendarPlus, note: NotebookPen, archive: Archive };

interface PaletteProps {
  onRun?: (id: string) => void;
  icons?: boolean;
  disabledItem?: string;
  loading?: boolean;
  actions?: readonly string[];
  labels?: Partial<CommandLabels> | undefined;
  dir?: 'ltr' | 'rtl' | undefined;
  lang?: string | undefined;
}

/** Inline palette (no dialog): the building block. */
function Palette({
  onRun,
  icons = true,
  disabledItem,
  loading = false,
  actions,
  labels,
  dir,
  lang,
}: PaletteProps) {
  return (
    <Command
      labels={labels}
      dir={dir}
      lang={lang}
      className="border-line shadow-3 w-96 max-w-full border"
    >
      <CommandInput labels={labels} />
      {/* Status rows sit beside the listbox: a listbox may only contain options and groups. */}
      {loading ? <CommandLoading labels={labels} /> : null}
      <CommandEmpty labels={labels} />
      <CommandList>
        <CommandGroup heading="Matters">
          <CommandItem value={MATTER_TITLE} onSelect={() => onRun?.('matter-1')}>
            <span className="truncate">{MATTER_TITLE}</span>
          </CommandItem>
          <CommandItem value={OTHER_MATTER} onSelect={() => onRun?.('matter-2')}>
            <span className="truncate">{OTHER_MATTER}</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {MATTER_ACTIONS.map((action, i) => {
            const Icon = ICONS[action.id];
            return (
              <CommandItem
                key={action.id}
                value={action.label}
                disabled={action.id === disabledItem}
                onSelect={() => onRun?.(action.id)}
              >
                {icons ? <Icon aria-hidden="true" /> : null}
                {actions?.[i] ?? action.label}
                {'shortcut' in action ? (
                  <CommandShortcut>
                    <Kbd hotkey={action.shortcut} mac={false} />
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** Palette in a dialog, opened with Ctrl+K (⌘K on a Mac) or the button. */
function PaletteDialog({
  onRun,
  ...props
}: PaletteProps & Partial<ComponentProps<typeof CommandDialog>>) {
  const [open, setOpen] = useState(false);
  useHotkey('mod+k', () => {
    setOpen((value) => !value);
  });
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Search <Kbd hotkey="mod+k" mac={false} />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} {...props}>
        <CommandInput />
        <CommandEmpty />
        <CommandList>
          <CommandGroup heading="Actions">
            {MATTER_ACTIONS.map((action) => (
              <CommandItem
                key={action.id}
                value={action.label}
                onSelect={() => {
                  onRun?.(action.id);
                  setOpen(false);
                }}
              >
                {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

const meta = {
  title: 'Components/Command',
  component: Palette,
  args: { onRun: fn() },
} satisfies Meta<typeof Palette>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const selected = (root: HTMLElement) => root.querySelector('[cmdk-item][data-selected="true"]');

export const Default: Story = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('combobox');
    await expect(input).toHaveAttribute('placeholder', 'Type a command or search');
    await expect(canvas.getAllByRole('option')).toHaveLength(2 + MATTER_ACTIONS.length);
  },
};

/** Keyboard: Ctrl+K opens, typing filters, arrows move, Enter runs, Esc closes. */
export const CommandPaletteKeyboard: Story = {
  render: (args) => <PaletteDialog {...args} />,
  play: async ({ canvas, args }) => {
    const trigger = canvas.getByRole('button', { name: /Search/ });
    trigger.focus();
    await userEvent.keyboard('{Control>}k{/Control}');
    const dialog = await page().findByRole('dialog', { name: 'Command palette' });
    const input = within(dialog).getByRole('combobox');
    await waitFor(() => expect(input).toHaveFocus());

    await userEvent.keyboard('note');
    await waitFor(() => expect(within(dialog).getAllByRole('option')).toHaveLength(1));
    await expect(selected(dialog)).toHaveTextContent('Add note');

    await userEvent.clear(input);
    await waitFor(() => expect(within(dialog).getAllByRole('option')).toHaveLength(4));
    await expect(selected(dialog)).toHaveTextContent('Open matter');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await expect(selected(dialog)).toHaveTextContent('Add note');
    await userEvent.keyboard('{ArrowUp}');
    await expect(selected(dialog)).toHaveTextContent('Add hearing');
    await userEvent.keyboard('{Enter}');
    await expect(args.onRun).toHaveBeenCalledWith('hearing');
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());

    await userEvent.keyboard('{Control>}k{/Control}');
    await page().findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page().queryByRole('dialog')).toBeNull());
    await expect(trigger).toHaveFocus();
  },
};

export const Empty: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('combobox'), 'vakalatnama register');
    await expect(await canvas.findByText('No results found.')).toBeInTheDocument();
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const option = canvas.getByRole('option', { name: /Add note/ });
    await userEvent.hover(option);
    await waitFor(() => expect(option).toHaveAttribute('data-selected', 'true'));
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('combobox')).toHaveFocus();
  },
};

export const Active: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('option', { name: /Archive matter/ }));
    await expect(args.onRun).toHaveBeenCalledWith('archive');
  },
};

export const Disabled: Story = {
  args: { disabledItem: 'archive' },
  play: async ({ canvas, args }) => {
    const option = canvas.getByRole('option', { name: /Archive matter/ });
    await expect(option).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(option, { pointerEventsCheck: 0 });
    await expect(args.onRun).not.toHaveBeenCalled();
  },
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
  },
};

export const WithIcon: Story = { args: { icons: true } };

export const LongText: Story = {
  play: async ({ canvas }) => {
    const option = canvas.getByRole('option', { name: MATTER_TITLE });
    await expect(option.getBoundingClientRect().width).toBeLessThanOrEqual(384);
  },
};

export const RtlNeutral: Story = {
  args: { dir: 'rtl' },
  play: async ({ canvas }) => {
    const option = canvas.getByRole('option', { name: /Open matter/ });
    const shortcut = option.querySelector('[data-slot="command-shortcut"]');
    // The shortcut sits at the inline end: left of the label in RTL.
    await expect(shortcut?.getBoundingClientRect().left).toBeLessThan(
      option.getBoundingClientRect().left + option.getBoundingClientRect().width / 2,
    );
  },
};

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    lang,
    actions: OVERLAY_INDIC[lang].actions,
    labels: { placeholder: OVERLAY_INDIC[lang].search, empty: OVERLAY_INDIC[lang].empty },
  },
  play: async ({ canvas }) => {
    const input = canvas.getByRole('combobox');
    await expect(input).toHaveAttribute('placeholder', OVERLAY_INDIC[lang].search);
    await userEvent.type(input, 'zzz');
    await expect(await canvas.findByText(OVERLAY_INDIC[lang].empty)).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
