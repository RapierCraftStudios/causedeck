import { cva, type VariantProps } from 'class-variance-authority';
import { Toggle as TogglePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export const toggleVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap select-none',
    'rounded-md border font-sans text-sm font-medium text-ink',
    'transition-colors duration-(--dur-fast) ease-standard motion-reduce:transition-none',
    'hover:bg-surface-sunken active:bg-line',
    'data-[state=on]:bg-accent-soft data-[state=on]:text-accent',
    'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
    'aria-invalid:border-danger',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    'pointer-coarse:hit',
    'forced-colors:border-current forced-colors:data-[state=on]:underline',
  ],
  {
    variants: {
      variant: {
        default: 'border-transparent bg-transparent',
        outline: 'border-line-control bg-transparent',
      },
      size: {
        sm: 'h-8 min-w-8 px-2 [&_svg]:size-3.5',
        md: 'h-9 min-w-9 px-2.5 [&_svg]:size-4',
        lg: 'h-11 min-w-11 px-3 [&_svg]:size-5',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export type ToggleVariant = NonNullable<VariantProps<typeof toggleVariants>['variant']>;
export type ToggleSize = NonNullable<VariantProps<typeof toggleVariants>['size']>;

export interface ToggleProps extends ComponentProps<typeof TogglePrimitive.Root> {
  variant?: ToggleVariant;
  size?: ToggleSize;
}

/** Two-state button (`aria-pressed`), e.g. a toolbar filter. */
export function Toggle({ variant = 'default', size = 'md', className, ...props }: ToggleProps) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      data-variant={variant}
      data-size={size}
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  );
}
