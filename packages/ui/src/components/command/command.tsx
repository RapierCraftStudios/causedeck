import { Command as CommandPrimitive, useCommandState } from 'cmdk';
import { Search } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { menuItemBase, menuSeparator, menuShortcut } from '../../lib/overlay';
import { Spinner } from '../spinner/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  type DialogContentProps,
} from '../dialog/dialog';

export interface CommandLabels {
  /** Accessible name of the palette (not shown). */
  label: string;
  /** Search input placeholder. */
  placeholder: string;
  /** Shown when nothing matches the search. */
  empty: string;
  /** Announced while results load. */
  loading: string;
  /** Screen-reader description of the palette dialog. */
  description: string;
  /** Accessible name of the dialog close button. */
  close: string;
}

export const DEFAULT_COMMAND_LABELS: CommandLabels = {
  label: 'Command palette',
  placeholder: 'Type a command or search',
  empty: 'No results found.',
  loading: 'Loading',
  description: 'Search for a matter or an action, then press Enter.',
  close: 'Close',
};

export interface CommandProps extends ComponentProps<typeof CommandPrimitive> {
  labels?: Partial<Pick<CommandLabels, 'label'>> | undefined;
}

export function Command({ labels, label, className, ...props }: CommandProps) {
  return (
    <CommandPrimitive
      data-slot="command"
      label={label ?? labels?.label ?? DEFAULT_COMMAND_LABELS.label}
      className={cn(
        'bg-surface-overlay text-ink flex h-full w-full flex-col overflow-hidden rounded-md',
        className,
      )}
      {...props}
    />
  );
}

export interface CommandInputProps extends ComponentProps<typeof CommandPrimitive.Input> {
  labels?: Partial<Pick<CommandLabels, 'placeholder'>> | undefined;
}

export function CommandInput({ labels, placeholder, className, ...props }: CommandInputProps) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="border-line flex h-11 items-center gap-2 border-b px-3"
    >
      <Search aria-hidden="true" className="text-ink-subtle size-4 shrink-0" />
      <CommandPrimitive.Input
        data-slot="command-input"
        placeholder={placeholder ?? labels?.placeholder ?? DEFAULT_COMMAND_LABELS.placeholder}
        className={cn(
          'text-ink placeholder:text-ink-subtle flex h-10 w-full bg-transparent text-sm outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-80 scroll-py-1 overflow-x-hidden overflow-y-auto p-1 max-md:max-h-none max-md:flex-1',
        // Items are not tabbable, so browsers make the scroller focusable. Its ring is drawn inside
        // the box: an outer offset would be clipped by the overflow-hidden palette. Important, to
        // beat the unlayered global `:focus-visible` offset (tokens/base.css).
        'focus-visible:outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2!',
        className,
      )}
      {...props}
    />
  );
}

export interface CommandEmptyProps extends ComponentProps<typeof CommandPrimitive.Empty> {
  labels?: Partial<Pick<CommandLabels, 'empty'>> | undefined;
}

/** Place inside `Command` beside `CommandList`, not in it: a listbox may only hold options. */
export function CommandEmpty({ labels, className, children, ...props }: CommandEmptyProps) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('text-ink-muted py-6 text-center text-sm', className)}
      {...props}
    >
      {children ?? labels?.empty ?? DEFAULT_COMMAND_LABELS.empty}
    </CommandPrimitive.Empty>
  );
}

export interface CommandLoadingProps extends ComponentProps<typeof CommandPrimitive.Loading> {
  labels?: Partial<Pick<CommandLabels, 'loading'>> | undefined;
}

/** Place inside `Command` beside `CommandList`, not in it: a listbox may only hold options. */
export function CommandLoading({ labels, className, ...props }: CommandLoadingProps) {
  const text = labels?.loading ?? DEFAULT_COMMAND_LABELS.loading;
  return (
    <CommandPrimitive.Loading
      data-slot="command-loading"
      label={text}
      className={cn('flex justify-center py-6', className)}
      {...props}
    >
      <Spinner decorative />
    </CommandPrimitive.Loading>
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'text-ink overflow-hidden p-1',
        '**:[[cmdk-group-heading]]:text-ink-subtle **:[[cmdk-group-heading]]:px-2',
        '**:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs',
        '**:[[cmdk-group-heading]]:font-medium',
        className,
      )}
      {...props}
    />
  );
}

export interface CommandSeparatorProps extends ComponentProps<'div'> {
  /** Keep the separator while searching (hidden by default, like cmdk's). */
  alwaysRender?: boolean;
}

/**
 * Decorative rule between groups. cmdk's own separator has role="separator", which a listbox may
 * not contain, so this one is presentational.
 */
export function CommandSeparator({
  alwaysRender = false,
  className,
  ...props
}: CommandSeparatorProps) {
  const searching = useCommandState((state) => state.search !== '');
  if (searching && !alwaysRender) return null;
  return (
    <div
      data-slot="command-separator"
      role="none"
      className={cn(menuSeparator, 'mx-0', className)}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        menuItemBase,
        // cmdk always sets data-selected and data-disabled, to "true" or "false".
        'data-[selected=true]:bg-surface-sunken forced-colors:data-[selected=true]:outline',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="command-shortcut" className={cn(menuShortcut, className)} {...props} />;
}

export interface CommandDialogProps
  extends
    Omit<ComponentProps<typeof Dialog>, 'children'>,
    Pick<ComponentProps<typeof CommandPrimitive>, 'filter' | 'shouldFilter' | 'loop'> {
  children: ReactNode;
  /** Visually hidden dialog title; defaults to `labels.label`. */
  title?: string;
  labels?: Partial<CommandLabels> | undefined;
  content?: Omit<DialogContentProps, 'children' | 'layout'>;
}

/** Command palette in a modal: centred on desktop, full screen under 768 px. */
export function CommandDialog({
  children,
  title,
  labels,
  content,
  filter,
  shouldFilter,
  loop = true,
  ...props
}: CommandDialogProps) {
  const text = { ...DEFAULT_COMMAND_LABELS, ...labels };
  return (
    <Dialog {...props}>
      <DialogContent
        layout="dialog"
        labels={{ close: text.close }}
        {...content}
        data-slot="command-dialog"
        className={cn(
          'gap-0 overflow-hidden p-0 md:top-1/4 md:translate-y-0',
          // Full screen on phones.
          'max-md:inset-0 max-md:h-dvh max-md:w-full max-md:max-w-none max-md:translate-x-0',
          'max-md:translate-y-0 max-md:rounded-none max-md:border-0',
          content?.className,
        )}
      >
        <DialogTitle className="sr-only">{title ?? text.label}</DialogTitle>
        <DialogDescription className="sr-only">{text.description}</DialogDescription>
        <Command
          label={title ?? text.label}
          loop={loop}
          {...(filter ? { filter } : {})}
          {...(shouldFilter === undefined ? {} : { shouldFilter })}
          // Room for the close button at the end of the search row.
          className="**:data-[slot=command-input-wrapper]:pe-12"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
