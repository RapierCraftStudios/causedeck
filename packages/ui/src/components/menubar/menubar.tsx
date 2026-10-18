import { Check, ChevronRight, Circle } from 'lucide-react';
import { Menubar as MenubarPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import {
  focusRing,
  menuContent,
  menuItem,
  menuLabel,
  menuSeparator,
  menuShortcut,
} from '../../lib/overlay';

export function Menubar({ className, ...props }: ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn(
        'border-line bg-surface-raised flex h-9 items-center gap-1 rounded-md border p-1',
        'forced-colors:border-current',
        className,
      )}
      {...props}
    />
  );
}

export function MenubarMenu(props: ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />;
}

export function MenubarGroup(props: ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />;
}

export function MenubarPortal(props: ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal data-slot="menubar-portal" {...props} />;
}

export function MenubarTrigger({
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        'text-ink flex items-center gap-2 rounded-sm px-2 py-1 text-sm font-medium select-none',
        'hover:bg-surface-sunken data-[state=open]:bg-surface-sunken focus:bg-surface-sunken',
        'ease-standard transition-colors duration-(--dur-fast)',
        'data-disabled:pointer-events-none data-disabled:opacity-50',
        'forced-colors:data-[state=open]:outline pointer-coarse:min-h-(--hit)',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function MenubarContent({
  align = 'start',
  alignOffset = -4,
  sideOffset = 8,
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(menuContent, className)}
        {...props}
      />
    </MenubarPrimitive.Portal>
  );
}

export interface MenubarItemProps extends ComponentProps<typeof MenubarPrimitive.Item> {
  variant?: 'default' | 'destructive';
  inset?: boolean;
}

export function MenubarItem({
  variant = 'default',
  inset = false,
  className,
  ...props
}: MenubarItemProps) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
      data-variant={variant}
      data-inset={inset ? '' : undefined}
      className={cn(menuItem, inset && 'ps-8', className)}
      {...props}
    />
  );
}

export function MenubarCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenubarPrimitive.CheckboxItem>) {
  return (
    <MenubarPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      className={cn(menuItem, 'ps-8', className)}
      {...props}
    >
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <MenubarPrimitive.ItemIndicator>
          <Check aria-hidden="true" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  );
}

export function MenubarRadioGroup(props: ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />;
}

export function MenubarRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenubarPrimitive.RadioItem>) {
  return (
    <MenubarPrimitive.RadioItem
      data-slot="menubar-radio-item"
      className={cn(menuItem, 'ps-8', className)}
      {...props}
    >
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <MenubarPrimitive.ItemIndicator>
          <Circle aria-hidden="true" className="size-2 fill-current" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.RadioItem>
  );
}

export function MenubarLabel({
  inset = false,
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.Label> & { inset?: boolean }) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      className={cn(menuLabel, inset && 'ps-8', className)}
      {...props}
    />
  );
}

export function MenubarSeparator({
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn(menuSeparator, className)}
      {...props}
    />
  );
}

export function MenubarShortcut({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="menubar-shortcut" className={cn(menuShortcut, className)} {...props} />;
}

export function MenubarSub(props: ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />;
}

export function MenubarSubTrigger({
  inset = false,
  className,
  children,
  ...props
}: ComponentProps<typeof MenubarPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
      className={cn(menuItem, 'data-[state=open]:bg-surface-sunken', inset && 'ps-8', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden="true" className="ms-auto rtl:rotate-180" />
    </MenubarPrimitive.SubTrigger>
  );
}

export function MenubarSubContent({
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive.SubContent>) {
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.SubContent
        data-slot="menubar-sub-content"
        className={cn(menuContent, className)}
        {...props}
      />
    </MenubarPrimitive.Portal>
  );
}
