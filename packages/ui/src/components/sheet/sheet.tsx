import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { scrim } from '../../lib/overlay';
import { Button } from '../button/button';

export const sheetContentVariants = cva(
  [
    'fixed z-modal flex flex-col gap-4 outline-none',
    'bg-surface-overlay text-ink border-line shadow-4 forced-colors:border-current',
    // 250 ms --ease-emphasized slide in; quicker exit.
    'data-[state=open]:animate-in data-[state=open]:duration-(--dur-slow) data-[state=open]:ease-emphasized',
    'data-[state=closed]:animate-out data-[state=closed]:duration-(--dur-base) data-[state=closed]:ease-exit',
  ],
  {
    variants: {
      side: {
        end: [
          'inset-y-0 end-0 h-full w-3/4 max-w-sm border-s p-6',
          'data-[state=open]:slide-in-from-end data-[state=closed]:slide-out-to-end',
        ],
        start: [
          'inset-y-0 start-0 h-full w-3/4 max-w-sm border-e p-6',
          'data-[state=open]:slide-in-from-start data-[state=closed]:slide-out-to-start',
        ],
        bottom: [
          'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t px-6 pt-2',
          // Clear the home indicator on notched phones.
          'pb-[calc(var(--space-6)+env(safe-area-inset-bottom))]',
          'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
        ],
      },
    },
    defaultVariants: { side: 'end' },
  },
);

export type SheetSide = NonNullable<VariantProps<typeof sheetContentVariants>['side']>;

export interface SheetLabels {
  /** Accessible name of the close button. */
  close: string;
}

export const DEFAULT_SHEET_LABELS: SheetLabels = { close: 'Close' };

export function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

export function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export function SheetOverlay({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay data-slot="sheet-overlay" className={cn(scrim, className)} {...props} />
  );
}

/** Decorative grab bar on bottom sheets. */
export function SheetHandle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-handle"
      aria-hidden="true"
      className={cn(
        'bg-line-strong mx-auto h-1 w-10 shrink-0 rounded-full forced-colors:bg-current',
        className,
      )}
      {...props}
    />
  );
}

/** Icon close button in the top inline-end corner of a dialog or sheet. */
export function OverlayCloseButton({ label }: { label: string }) {
  return (
    <SheetPrimitive.Close asChild>
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        data-slot="overlay-close"
        className="text-ink-muted absolute end-3 top-3 size-8 px-0"
      >
        <X aria-hidden="true" />
      </Button>
    </SheetPrimitive.Close>
  );
}

export interface SheetContentProps extends ComponentProps<typeof SheetPrimitive.Content> {
  side?: SheetSide | undefined;
  /** Show the icon close button (default true). */
  showClose?: boolean | undefined;
  labels?: Partial<SheetLabels> | undefined;
}

export function SheetContent({
  side = 'end',
  showClose = true,
  labels,
  className,
  children,
  ...props
}: SheetContentProps) {
  const text = { ...DEFAULT_SHEET_LABELS, ...labels };
  return (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(sheetContentVariants({ side }), className)}
        {...props}
      >
        {side === 'bottom' ? <SheetHandle /> : null}
        {children}
        {showClose ? <OverlayCloseButton label={text.close} /> : null}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 pe-8', className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-ink font-serif text-lg', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-ink-muted text-sm', className)}
      {...props}
    />
  );
}
