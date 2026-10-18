import type { ComponentProps } from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { cn } from '../../lib/cn';
import { floatingSurface, scrim } from '../../lib/overlay';
import { SheetHandle } from '../sheet/sheet';

/**
 * Draggable sheet (vaul): swipe down to dismiss on touch, Esc on keyboard. Use it for phone-first
 * flows; `Sheet` is the non-draggable side or bottom panel.
 */
export function Drawer({
  autoFocus = true,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Root>) {
  // vaul skips focusing the content by default; keyboard users need focus moved in.
  return <DrawerPrimitive.Root data-slot="drawer" autoFocus={autoFocus} {...props} />;
}

export function DrawerTrigger(props: ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

export function DrawerClose(props: ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

export function DrawerPortal(props: ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

export function DrawerOverlay({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(scrim, className)}
      {...props}
    />
  );
}

/**
 * vaul ships a 0.5 s slide in an unlayered style tag, which beats layered utilities, hence `!`.
 * The values are tokens (250 ms --ease-emphasized), so reduced motion still makes them 0.01 ms.
 */
const drawerMotion = [
  'data-[vaul-drawer]:duration-(--dur-slow)! data-[vaul-drawer]:ease-emphasized!',
  'data-[vaul-drawer]:[animation-duration:var(--dur-slow)]!',
  'data-[vaul-drawer]:[animation-timing-function:var(--ease-emphasized)]!',
].join(' ');

export function DrawerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          'group/drawer z-modal fixed flex h-auto flex-col outline-none',
          floatingSurface,
          'shadow-4',
          drawerMotion,
          // Bottom (default): 16 px top radius, handle, safe-area padding.
          'data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0',
          'data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:rounded-t-xl',
          'data-[vaul-drawer-direction=bottom]:border-x-0 data-[vaul-drawer-direction=bottom]:border-b-0',
          'data-[vaul-drawer-direction=bottom]:pb-[env(safe-area-inset-bottom)]',
          'data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0',
          'data-[vaul-drawer-direction=top]:max-h-[85dvh] data-[vaul-drawer-direction=top]:rounded-b-xl',
          'data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0',
          'data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:max-w-sm',
          'data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0',
          'data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:max-w-sm',
          className,
        )}
        {...props}
      >
        <SheetHandle className="mt-2 hidden group-data-[vaul-drawer-direction=bottom]/drawer:block" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

export function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn('flex flex-col gap-1.5 p-4 text-start', className)}
      {...props}
    />
  );
}

export function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  );
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-ink font-serif text-lg', className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-ink-muted text-sm', className)}
      {...props}
    />
  );
}
