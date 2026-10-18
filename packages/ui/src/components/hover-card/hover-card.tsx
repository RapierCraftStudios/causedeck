import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { floatingSurface, menuMotion } from '../../lib/overlay';

/** Preview card shown on hover or focus: same surface and motion as popovers. */
export const hoverCardContentClasses = [
  'z-popover w-72 max-w-(--radix-hover-card-content-available-width) rounded-md p-4 text-sm outline-none',
  floatingSurface,
  menuMotion,
].join(' ');

export function HoverCard({
  openDelay = 300,
  closeDelay = 150,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Root>) {
  return (
    <HoverCardPrimitive.Root
      data-slot="hover-card"
      openDelay={openDelay}
      closeDelay={closeDelay}
      {...props}
    />
  );
}

export function HoverCardTrigger(props: ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}

export function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(hoverCardContentClasses, className)}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}
