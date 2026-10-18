import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

/**
 * Small inverted bubble. Radix tooltips are `delayed-open` or `instant-open` while shown: fade
 * plus 4 px move over 150 ms `--ease-enter`, close over 100 ms `--ease-exit`.
 */
export const tooltipContentClasses = [
  'z-tooltip max-w-xs rounded-sm px-2 py-1 text-xs text-balance',
  'bg-ink text-surface shadow-2 forced-colors:border forced-colors:border-current',
  'origin-(--radix-tooltip-content-transform-origin)',
  'animate-in fade-in-0 duration-(--dur-fast) ease-enter',
  'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
  'data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'data-[state=closed]:duration-(--dur-exit) data-[state=closed]:ease-exit',
].join(' ');

export function TooltipProvider({
  delayDuration = 300,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/** A tooltip with its own provider, so it works without an app-level `TooltipProvider`. */
export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(tooltipContentClasses, className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
