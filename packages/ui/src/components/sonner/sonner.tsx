import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { Toaster as SonnerToaster, toast, type ToasterProps as SonnerToasterProps } from 'sonner';

import { cn } from '../../lib/cn';
import { buttonVariants } from '../button/button';
import { Spinner } from '../spinner/spinner';
import './sonner.css';

/** At most three toasts are stacked at once; older ones wait (hidden) until one closes. */
export const MAX_VISIBLE_TOASTS = 3;

export interface ToasterLabels {
  /** Close button on each toast. */
  close: string;
  /** Name of the notifications landmark (sonner appends the focus hotkey, e.g. "alt+T"). */
  region: string;
}

export const DEFAULT_TOASTER_LABELS: ToasterLabels = {
  close: 'Dismiss notification',
  region: 'Notifications',
};

type ToastClassNames = NonNullable<NonNullable<SonnerToasterProps['toastOptions']>['classNames']>;

const TOAST_CLASSNAMES: ToastClassNames = {
  toast: cn(
    'group/toast flex w-(--width) items-center gap-3 rounded-lg border border-line p-4',
    'bg-surface-overlay text-ink shadow-3 font-sans text-sm',
    'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
    'forced-colors:border-current',
  ),
  content: 'flex min-w-0 flex-1 flex-col gap-0.5',
  title: 'font-medium text-ink',
  description: 'text-ink-muted',
  icon: 'flex shrink-0 [&_svg]:size-4',
  success: '[&_[data-icon]]:text-success',
  info: '[&_[data-icon]]:text-info',
  warning: '[&_[data-icon]]:text-warning',
  error: 'border-danger [&_[data-icon]]:text-danger',
  actionButton: buttonVariants({ variant: 'secondary', size: 'sm' }),
  cancelButton: buttonVariants({ variant: 'ghost', size: 'sm' }),
  closeButton: cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'order-last size-8 px-0'),
};

const ICONS = {
  success: <CircleCheck aria-hidden="true" />,
  info: <Info aria-hidden="true" />,
  warning: <TriangleAlert aria-hidden="true" />,
  error: <CircleAlert aria-hidden="true" />,
  loading: <Spinner size="md" decorative />,
  close: <X aria-hidden="true" className="size-4" />,
};

/** Consumer class names extend the themed ones instead of replacing them. */
function mergeClassNames(
  base: ToastClassNames,
  extra: ToastClassNames | undefined,
): ToastClassNames {
  if (extra === undefined) return base;
  const merged: ToastClassNames = { ...base };
  for (const key of Object.keys(extra) as (keyof ToastClassNames)[]) {
    merged[key] = cn(base[key], extra[key]);
  }
  return merged;
}

export interface ToasterProps extends Omit<
  SonnerToasterProps,
  'visibleToasts' | 'containerAriaLabel' | 'theme' | 'richColors'
> {
  /** Stack limit, capped at {@link MAX_VISIBLE_TOASTS}. */
  visibleToasts?: number;
  labels?: Partial<ToasterLabels>;
}

/**
 * App-wide toaster (sonner) themed with the tokens. Toasts live in a polite live region, carry
 * an optional action (e.g. Undo via `toast('Draft deleted', { action: { label, onClick } })`) and
 * stack at most three deep. Mount once; fire toasts with the re-exported `toast`.
 */
export function Toaster({
  visibleToasts = MAX_VISIBLE_TOASTS,
  labels,
  closeButton = true,
  position = 'bottom-right',
  icons,
  toastOptions,
  className,
  ...props
}: ToasterProps) {
  const text = { ...DEFAULT_TOASTER_LABELS, ...labels };
  return (
    <SonnerToaster
      className={cn('cd-toaster', className)}
      visibleToasts={Math.min(Math.max(1, visibleToasts), MAX_VISIBLE_TOASTS)}
      closeButton={closeButton}
      position={position}
      containerAriaLabel={text.region}
      icons={{ ...ICONS, ...icons }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: text.close,
        ...toastOptions,
        classNames: mergeClassNames(TOAST_CLASSNAMES, toastOptions?.classNames),
      }}
      {...props}
    />
  );
}

export { toast };
