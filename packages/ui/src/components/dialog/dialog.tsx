import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef, type ComponentProps } from 'react';

import { useMediaQuery } from '../../hooks/use-media-query';
import { cn } from '../../lib/cn';
import { floatingSurface, scrim } from '../../lib/overlay';
import { OverlayCloseButton, SheetHandle, sheetContentVariants } from '../sheet/sheet';

/** Under this width a dialog is laid out as a bottom sheet. */
export const DIALOG_SHEET_QUERY = '(max-width: 767px)';

export interface DialogLabels {
  /** Accessible name of the close button. */
  close: string;
}

export const DEFAULT_DIALOG_LABELS: DialogLabels = { close: 'Close' };

/** Centred modal: 200 ms fade plus scale 0.98 to 1; closes over 100 ms. */
export const dialogContentClasses = [
  'fixed top-1/2 left-1/2 z-modal -translate-x-1/2 -translate-y-1/2',
  'grid w-[calc(100%-var(--space-8))] max-w-lg gap-4 rounded-lg p-6 outline-none',
  floatingSurface,
  'shadow-4',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98',
  'data-[state=open]:duration-(--dur-base) data-[state=open]:ease-standard',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98',
  'data-[state=closed]:duration-(--dur-exit) data-[state=closed]:ease-exit',
].join(' ');

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(scrim, className)}
      {...props}
    />
  );
}

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** Show the icon close button (default true). */
  showClose?: boolean | undefined;
  /** `auto` (default) becomes a bottom sheet under 768 px; `dialog` always stays centred. */
  layout?: 'auto' | 'dialog' | 'sheet' | undefined;
  labels?: Partial<DialogLabels> | undefined;
}

/** Modal content. Always pair with `DialogTitle` and `DialogDescription`. */
export function DialogContent({
  showClose = true,
  layout = 'auto',
  labels,
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DialogContentProps) {
  const text = { ...DEFAULT_DIALOG_LABELS, ...labels };
  const narrow = useMediaQuery(DIALOG_SHEET_QUERY);
  // Radix returns focus only to a DialogTrigger. Dialogs opened another way (a hotkey such as
  // mod+k or ?) return it to whatever had focus when they opened.
  const returnFocus = useRef<HTMLElement | null>(null);
  const asSheet = layout === 'sheet' || (layout === 'auto' && narrow);
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-layout={asSheet ? 'sheet' : 'dialog'}
        className={cn(
          asSheet ? sheetContentVariants({ side: 'bottom' }) : dialogContentClasses,
          className,
        )}
        onOpenAutoFocus={(event) => {
          const active = document.activeElement;
          returnFocus.current =
            active instanceof HTMLElement && active !== document.body ? active : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const target = returnFocus.current;
          returnFocus.current = null;
          if (event.defaultPrevented || !target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
        {...props}
      >
        {asSheet ? <SheetHandle /> : null}
        {children}
        {showClose ? <OverlayCloseButton label={text.close} /> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 pe-8 text-start', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-ink font-serif text-lg', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-ink-muted text-sm', className)}
      {...props}
    />
  );
}
