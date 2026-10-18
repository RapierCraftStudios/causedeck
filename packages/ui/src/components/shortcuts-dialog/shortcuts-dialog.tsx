import { useState, type ComponentProps } from 'react';

import { DEFAULT_HOTKEY_LABELS, useHotkey } from '../../hooks/use-hotkey';
import { cn } from '../../lib/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  type DialogContentProps,
} from '../dialog/dialog';
import { Kbd } from '../kbd/kbd';

export interface Shortcut {
  /** Hotkey in `useHotkey` syntax: `mod+k`, `?`, `g then t`. */
  keys: string;
  /** What it does, e.g. "Go to today". */
  description: string;
  /** Section heading; shortcuts without one are listed first. */
  group?: string;
}

export interface ShortcutsDialogLabels {
  title: string;
  description: string;
  /** Accessible name of the close button. */
  close: string;
  /** Joins chord steps in the key hints (`G then T`). */
  then: string;
}

export const DEFAULT_SHORTCUTS_DIALOG_LABELS: ShortcutsDialogLabels = {
  title: 'Keyboard shortcuts',
  description: 'Shortcuts work anywhere except while you are typing in a field.',
  close: 'Close',
  then: DEFAULT_HOTKEY_LABELS.then,
};

export interface ShortcutsDialogProps {
  shortcuts: readonly Shortcut[];
  /** Controlled open state; leave unset to let the hotkey own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Key that toggles the dialog (default `?`). Ignored while typing in a field. */
  hotkey?: string;
  /** Turn the built-in hotkey off when the app shell (#11) binds it itself. */
  enableHotkey?: boolean;
  /** Override platform detection for the key hints (stories, server rendering). */
  mac?: boolean;
  labels?: Partial<ShortcutsDialogLabels> | undefined;
  content?: Omit<DialogContentProps, 'children'>;
}

/** Group shortcuts by `group`, keeping first-seen order; ungrouped ones come first. */
export function groupShortcuts(shortcuts: readonly Shortcut[]): [string, Shortcut[]][] {
  const groups = new Map<string, Shortcut[]>();
  for (const shortcut of shortcuts) {
    const key = shortcut.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), shortcut]);
  }
  const ungrouped = groups.get('');
  groups.delete('');
  return ungrouped ? [['', ungrouped], ...groups] : [...groups];
}

/**
 * The `?` shortcuts dialog: a list of every keyboard shortcut with platform-aware key hints.
 * Building block for the app shell; pass the shell's shortcut registry as `shortcuts`.
 */
export function ShortcutsDialog({
  shortcuts,
  open: openProp,
  onOpenChange,
  hotkey = '?',
  enableHotkey = true,
  mac,
  labels,
  content,
}: ShortcutsDialogProps) {
  const text = { ...DEFAULT_SHORTCUTS_DIALOG_LABELS, ...labels };
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  useHotkey(
    hotkey,
    () => {
      setOpen(!open);
    },
    { enabled: enableHotkey },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent labels={{ close: text.close }} {...content} data-slot="shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex max-h-[60dvh] flex-col gap-4 overflow-y-auto px-1">
          {groupShortcuts(shortcuts).map(([group, items]) => (
            <ShortcutGroup key={group || 'ungrouped'} heading={group} mac={mac} then={text.then}>
              {items}
            </ShortcutGroup>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ShortcutGroupProps extends Omit<ComponentProps<'section'>, 'children'> {
  heading: string;
  children: Shortcut[];
  mac: boolean | undefined;
  then: string;
}

function ShortcutGroup({ heading, children, mac, then, className, ...props }: ShortcutGroupProps) {
  return (
    <section
      data-slot="shortcuts-group"
      aria-label={heading || undefined}
      className={cn('flex flex-col gap-1', className)}
      {...props}
    >
      {heading ? (
        <h3 className="text-eyebrow text-ink-muted font-medium tracking-wide uppercase">
          {heading}
        </h3>
      ) : null}
      <dl className="divide-line flex flex-col divide-y">
        {children.map((shortcut) => (
          <div
            key={shortcut.keys}
            data-slot="shortcut"
            className="flex items-center justify-between gap-4 py-2"
          >
            <dt className="text-ink text-sm">{shortcut.description}</dt>
            <dd className="shrink-0">
              <Kbd
                hotkey={shortcut.keys}
                labels={{ then }}
                {...(mac === undefined ? {} : { mac })}
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
