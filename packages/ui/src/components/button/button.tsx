import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { Spinner } from '../spinner/spinner';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap select-none',
    'rounded-md border border-transparent font-sans font-medium',
    'transition-colors duration-(--dur-fast) ease-standard',
    'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    // Touch devices: at least --hit (44 px) square, whatever the visual size.
    'pointer-coarse:hit',
    // Forced colours: the transparent border becomes a system-colour outline.
    'forced-colors:border-current',
    // Tamil and Kannada labels run long: wrap to more lines at the size's height as a minimum,
    // rather than overflowing (#176). English keeps one line at a fixed height.
    '[&:is(:lang(ta),:lang(kn))]:h-auto [&:is(:lang(ta),:lang(kn))]:py-1.5 [&:is(:lang(ta),:lang(kn))]:text-center [&:is(:lang(ta),:lang(kn))]:text-balance [&:is(:lang(ta),:lang(kn))]:whitespace-normal',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:bg-accent/90 active:bg-accent/80',
        secondary:
          'border-line-strong bg-surface-sunken text-ink hover:bg-line active:bg-line-strong',
        ghost: 'bg-transparent text-ink hover:bg-surface-sunken active:bg-line',
        outline:
          'border-line-control bg-transparent text-ink hover:bg-surface-sunken active:bg-line',
        destructive:
          'bg-danger-soft text-danger hover:border-danger active:border-danger active:bg-danger-soft/80',
        link: 'bg-transparent text-accent underline-offset-4 hover:underline active:text-ink',
      },
      size: {
        sm: 'h-8 [&:is(:lang(ta),:lang(kn))]:min-h-8 px-3 text-sm [&_svg]:size-3.5',
        md: 'h-9 [&:is(:lang(ta),:lang(kn))]:min-h-9 px-4 text-sm [&_svg]:size-4',
        lg: 'h-11 [&:is(:lang(ta),:lang(kn))]:min-h-11 px-5 text-base [&_svg]:size-5',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonLabels {
  /** Appended to the accessible name while `loading`; the label stays (transparent) to keep the width. */
  loading: string;
}

export const DEFAULT_BUTTON_LABELS: ButtonLabels = { loading: 'Loading' };

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a spinner and block interaction without changing the button's size. */
  loading?: boolean;
  /** Render the child element (e.g. a link) with button styling. `loading` is ignored. */
  asChild?: boolean;
  labels?: Partial<ButtonLabels>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  asChild = false,
  disabled,
  labels,
  className,
  children,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={classes}
        {...props}
      >
        {children}
      </Slot.Root>
    );
  }

  const text = { ...DEFAULT_BUTTON_LABELS, ...labels };
  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading ? '' : undefined}
      type={type ?? 'button'}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      <span
        data-slot="button-label"
        // opacity, not visibility: the label stays in the accessibility tree and keeps the width.
        className={cn('inline-flex items-center gap-[inherit]', loading && 'opacity-0')}
      >
        {children}
      </span>
      {loading ? ' ' : null}
      {loading ? (
        <span
          data-slot="button-spinner"
          className="absolute inset-0 inline-flex items-center justify-center"
        >
          <Spinner size={size} decorative />
          <span className="sr-only">{text.loading}</span>
        </span>
      ) : null}
    </button>
  );
}
