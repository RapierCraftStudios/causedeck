import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface ScrollAreaProps extends ComponentProps<typeof ScrollAreaPrimitive.Root> {
  /** Names the scrollable region (role=region) for screen readers. */
  label?: string;
  /** Which scrollbars to render. */
  orientation?: 'vertical' | 'horizontal' | 'both';
}

/**
 * Scroll container with token-styled scrollbars. The viewport is focusable so keyboard users can
 * scroll it with the arrow keys.
 */
export function ScrollArea({
  label,
  orientation = 'vertical',
  className,
  children,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        tabIndex={0}
        role={label === undefined ? undefined : 'region'}
        aria-label={label}
        className="focus-visible:outline-ring size-full -outline-offset-2 focus-visible:outline-2"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation === 'horizontal' ? null : <ScrollBar orientation="vertical" />}
      {orientation === 'vertical' ? null : <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export type ScrollBarProps = ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>;

export function ScrollBar({ orientation = 'vertical', className, ...props }: ScrollBarProps) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors duration-(--dur-fast) select-none',
        orientation === 'vertical' && 'h-full w-2.5 border-s border-s-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="bg-line-strong hover:bg-ink-subtle relative flex-1 rounded-full forced-colors:bg-[CanvasText]"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
