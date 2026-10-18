import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { scrim } from '../../lib/overlay';
import { buttonVariants, type ButtonVariant } from '../button/button';
import { dialogContentClasses } from '../dialog/dialog';

/**
 * Confirmation that needs an explicit choice: no close button, the overlay does not dismiss.
 * Esc cancels. Copy (title, description, both actions) comes from the caller.
 */
export function AlertDialog(props: ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

export function AlertDialogTrigger(props: ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

export function AlertDialogOverlay({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(scrim, className)}
      {...props}
    />
  );
}

export function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(dialogContentClasses, 'max-w-md', className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-1.5 text-start', className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-ink font-serif text-lg', className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-ink-muted text-sm', className)}
      {...props}
    />
  );
}

export interface AlertDialogActionProps extends ComponentProps<typeof AlertDialogPrimitive.Action> {
  /** `destructive` for irreversible actions (delete, archive). */
  variant?: Extract<ButtonVariant, 'primary' | 'destructive'>;
}

export function AlertDialogAction({
  variant = 'primary',
  className,
  ...props
}: AlertDialogActionProps) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      data-variant={variant}
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertDialogCancel({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: 'secondary' }), className)}
      {...props}
    />
  );
}
