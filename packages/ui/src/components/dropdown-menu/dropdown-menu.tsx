import { Check, ChevronRight, Circle } from 'lucide-react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { useMediaQuery } from '../../hooks/use-media-query';
import { cn } from '../../lib/cn';
import {
  floatingSurface,
  menuContent,
  menuItem,
  menuLabel,
  menuSeparator,
  menuShortcut,
} from '../../lib/overlay';
import './dropdown-menu.css';

/** Touch widths: the menu opens as a bottom sheet list instead of a popover. */
export const DROPDOWN_SHEET_QUERY = '(pointer: coarse) and (max-width: 767px)';

/** Bottom sheet list: full width, 16 px top radius, safe-area padding, 44 px rows. */
export const dropdownSheetClasses = [
  'fixed inset-x-0 bottom-0 z-popover w-full max-h-[70dvh] overflow-y-auto',
  'rounded-t-xl border-t px-2 pt-2 pb-[calc(var(--space-2)+env(safe-area-inset-bottom))]',
  floatingSurface,
  'shadow-4 [&_[role^=menuitem]]:min-h-(--hit)',
  'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
  'data-[state=open]:duration-(--dur-slow) data-[state=open]:ease-emphasized',
  'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
  'data-[state=closed]:duration-(--dur-exit) data-[state=closed]:ease-exit',
].join(' ');

/**
 * Menu button. Non-modal by default: the page stays in the accessibility tree (no `aria-hidden`
 * over a still-focusable trigger) while focus, arrows, typeahead and Esc behave as usual.
 */
export function DropdownMenu({
  modal = false,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" modal={modal} {...props} />;
}

export function DropdownMenuPortal(props: ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export interface DropdownMenuContentProps extends ComponentProps<
  typeof DropdownMenuPrimitive.Content
> {
  /** `auto` (default) becomes a bottom sheet list on touch widths. */
  layout?: 'auto' | 'menu' | 'sheet';
}

export function DropdownMenuContent({
  layout = 'auto',
  sideOffset = 4,
  className,
  ...props
}: DropdownMenuContentProps) {
  const touch = useMediaQuery(DROPDOWN_SHEET_QUERY);
  const asSheet = layout === 'sheet' || (layout === 'auto' && touch);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        data-layout={asSheet ? 'sheet' : 'menu'}
        sideOffset={sideOffset}
        avoidCollisions={!asSheet}
        className={cn(asSheet ? dropdownSheetClasses : menuContent, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuGroup(props: ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

export interface DropdownMenuItemProps extends ComponentProps<typeof DropdownMenuPrimitive.Item> {
  variant?: 'default' | 'destructive';
  /** Indent to line up with checkbox and radio items. */
  inset?: boolean;
}

export function DropdownMenuItem({
  variant = 'default',
  inset = false,
  className,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      data-inset={inset ? '' : undefined}
      className={cn(menuItem, inset && 'ps-8', className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(menuItem, 'ps-8', className)}
      {...props}
    >
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioGroup(
  props: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(menuItem, 'ps-8', className)}
      {...props}
    >
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle aria-hidden="true" className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  inset = false,
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(menuLabel, inset && 'ps-8', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn(menuSeparator, className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span data-slot="dropdown-menu-shortcut" className={cn(menuShortcut, className)} {...props} />
  );
}

export function DropdownMenuSub(props: ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

export function DropdownMenuSubTrigger({
  inset = false,
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(menuItem, 'data-[state=open]:bg-surface-sunken', inset && 'ps-8', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden="true" className="ms-auto rtl:rotate-180" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(menuContent, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
