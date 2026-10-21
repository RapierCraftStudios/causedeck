import { Tabs as TabsPrimitive } from 'radix-ui';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { focusRing } from '../../lib/overlay';

/** Width of the edge fade on an overflowing tab list. */
export const TABS_FADE = '24px';

interface Overflow {
  start: boolean;
  end: boolean;
  rtl: boolean;
}

/** Track whether a horizontally scrollable element has hidden content at either inline edge. */
export function useScrollOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflow, setOverflow] = useState<Overflow>({ start: false, end: false, rtl: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const max = el.scrollWidth - el.clientWidth;
    // In RTL, scrollLeft runs from 0 to -max.
    const offset = Math.abs(el.scrollLeft);
    const next = { start: max > 1 && offset > 1, end: max > 1 && offset < max - 1, rtl };
    setOverflow((prev) =>
      prev.start === next.start && prev.end === next.end && prev.rtl === next.rtl ? prev : next,
    );
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [measure]);

  return { ref, overflow };
}

/** Alpha mask that fades the overflowing edge(s). `black` and `transparent` are mask alpha only. */
export function fadeMask({ start, end, rtl }: Overflow): string | undefined {
  if (!start && !end) return undefined;
  const from = start ? `transparent, black ${TABS_FADE}` : 'black';
  const to = end ? `black calc(100% - ${TABS_FADE}), transparent` : 'black';
  return `linear-gradient(to ${rtl ? 'left' : 'right'}, ${from}, ${to})`;
}

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    />
  );
}

/** Tab list: scrolls horizontally when the tabs do not fit, fading the hidden edge. */
export function TabsList({
  className,
  style,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  const { ref, overflow } = useScrollOverflow<HTMLDivElement>();
  const mask = fadeMask(overflow);
  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="tabs-list"
      data-fade-start={overflow.start ? '' : undefined}
      data-fade-end={overflow.end ? '' : undefined}
      className={cn(
        'border-line flex max-w-full items-end gap-1 border-b',
        'snap-x [scrollbar-width:none] overflow-x-auto overflow-y-hidden overscroll-x-contain',
        '[&::-webkit-scrollbar]:hidden',
        className,
      )}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask, ...style } : style}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative inline-flex h-9 shrink-0 snap-start items-center justify-center gap-2 px-3',
        'text-ink-muted rounded-t-sm text-sm font-medium whitespace-nowrap select-none',
        'ease-standard transition-colors duration-(--dur-fast)',
        'hover:text-ink active:bg-surface-sunken',
        // Selected: ink text plus a 2 px accent bar on the list's bottom border.
        'data-[state=active]:text-ink',
        'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full',
        'data-[state=active]:after:bg-accent forced-colors:data-[state=active]:after:bg-current',
        'focus-visible:outline-ring -outline-offset-2 focus-visible:outline-2',
        'disabled:pointer-events-none disabled:opacity-50',
        'pointer-coarse:h-11',
        '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('text-ink rounded-sm text-sm', focusRing, className)}
      {...props}
    />
  );
}
