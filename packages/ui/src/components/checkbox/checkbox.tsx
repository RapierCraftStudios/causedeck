'use client';

import { Check, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps, MouseEvent } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from '../field/field';

/** Shared box styles for Checkbox and RadioGroupItem: 16 px, 44 px touch target. */
export const checkControlClasses = [
  'peer relative inline-flex size-4 shrink-0 items-center justify-center',
  'border border-line-control bg-surface-raised text-accent-ink',
  'transition-colors duration-(--dur-fast) ease-standard motion-reduce:transition-none',
  'hover:border-accent',
  'outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
  'aria-invalid:border-danger aria-invalid:hover:border-danger',
  'data-readonly:cursor-default data-readonly:bg-surface-sunken',
  'disabled:cursor-not-allowed disabled:opacity-50',
  // Touch: an invisible 44 px hit area around the 16 px box.
  'pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5',
  'forced-colors:border-current',
].join(' ');

export interface CheckboxProps extends ComponentProps<typeof CheckboxPrimitive.Root> {
  /** Show the state but ignore clicks and Space; stays focusable. */
  readOnly?: boolean | undefined;
}

/** Two-state (or indeterminate) checkbox; wires itself to a surrounding `Field`. */
export function Checkbox({ className, readOnly, onClick, ...props }: CheckboxProps) {
  const control = useFieldControl({ ...props, readOnly });
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      {...props}
      {...control.ariaProps}
      id={control.id}
      disabled={control.disabled}
      required={control.required}
      aria-readonly={control.readOnly || undefined}
      data-readonly={control.readOnly ? '' : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (control.readOnly) event.preventDefault();
      }}
      className={cn(
        checkControlClasses,
        'rounded-xs',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/indicator flex items-center justify-center text-current"
      >
        <Check
          aria-hidden="true"
          className="size-3.5 group-data-[state=indeterminate]/indicator:hidden"
          strokeWidth={3}
        />
        <Minus
          aria-hidden="true"
          className="hidden size-3.5 group-data-[state=indeterminate]/indicator:block"
          strokeWidth={3}
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
