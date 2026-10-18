'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps, MouseEvent } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from '../field/field';

export interface SwitchProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  /** Show the state but ignore clicks and Space; stays focusable. */
  readOnly?: boolean | undefined;
}

/** On/off setting that applies immediately. The thumb jumps (no slide) under reduced motion. */
export function Switch({ className, readOnly, onClick, ...props }: SwitchProps) {
  const control = useFieldControl({ ...props, readOnly });
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
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
        'peer border-line-control relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-px',
        'bg-surface-sunken data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'ease-standard transition-colors duration-(--dur-fast) motion-reduce:transition-none',
        'focus-visible:outline-ring outline-offset-2 focus-visible:outline-2',
        'aria-invalid:border-danger',
        'data-readonly:cursor-default',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3',
        'forced-colors:border-current',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'bg-line-control shadow-1 pointer-events-none block size-4 rounded-full',
          'data-[state=checked]:bg-accent-ink',
          'translate-x-0 data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4',
          'ease-standard transition-transform duration-(--dur-fast) motion-reduce:transition-none',
          'forced-colors:bg-current',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
