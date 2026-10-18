import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export const alertVariants = cva(
  [
    'relative flex w-full items-start gap-3 rounded-md border px-4 py-3 font-sans text-sm',
    '[&>[data-slot=alert-icon]_svg]:size-4',
  ],
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-sunken text-ink [&>[data-slot=alert-icon]]:text-ink-muted',
        info: 'border-line bg-info-soft text-ink [&>[data-slot=alert-icon]]:text-info',
        success: 'border-line bg-success-soft text-ink [&>[data-slot=alert-icon]]:text-success',
        warning: 'border-line bg-warning-soft text-ink [&>[data-slot=alert-icon]]:text-warning',
        danger: 'border-danger bg-danger-soft text-ink [&>[data-slot=alert-icon]]:text-danger',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

export type AlertTone = NonNullable<VariantProps<typeof alertVariants>['tone']>;

const ICONS: Record<AlertTone, ReactNode> = {
  neutral: <Info />,
  info: <Info />,
  success: <CircleCheck />,
  warning: <TriangleAlert />,
  danger: <CircleAlert />,
};

export interface AlertProps extends ComponentProps<'div'> {
  tone?: AlertTone;
  /** Replaces the tone icon; `null` hides it. The icon is decorative (the text carries meaning). */
  icon?: ReactNode;
  /** Trailing action, e.g. a "Try again" button. */
  action?: ReactNode;
}

/**
 * Inline message. Danger alerts use role=alert (announced at once); the others role=status.
 * Every tone has an icon so colour is never the only signal.
 */
export function Alert({
  tone = 'info',
  icon,
  action,
  role,
  className,
  children,
  ...props
}: AlertProps) {
  const glyph = icon === undefined ? ICONS[tone] : icon;
  return (
    <div
      data-slot="alert"
      data-tone={tone}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {glyph === null ? null : (
        <span data-slot="alert-icon" aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
          {glyph}
        </span>
      )}
      <div data-slot="alert-body" className="grid min-w-0 flex-1 gap-1">
        {children}
      </div>
      {action === undefined ? null : (
        <div data-slot="alert-action" className="shrink-0 self-center">
          {action}
        </div>
      )}
    </div>
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="alert-title" className={cn('text-ink font-medium', className)} {...props} />
  );
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="alert-description" className={cn('text-ink-muted', className)} {...props} />
  );
}
