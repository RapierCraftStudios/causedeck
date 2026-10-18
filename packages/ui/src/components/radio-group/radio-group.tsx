'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { createContext, useContext, type ComponentProps, type MouseEvent } from 'react';

import { cn } from '../../lib/cn';
import { checkControlClasses } from '../checkbox/checkbox';
import { useFieldControl } from '../field/field';

const ReadOnlyContext = createContext(false);

export interface RadioGroupProps extends ComponentProps<typeof RadioGroupPrimitive.Root> {
  /** Show the choice but ignore clicks and arrow keys selecting; items stay focusable. */
  readOnly?: boolean | undefined;
}

/** One choice from a few visible options; wires itself to a surrounding `Field`. */
export function RadioGroup({ className, readOnly, ...props }: RadioGroupProps) {
  const control = useFieldControl({ ...props, readOnly });
  return (
    <ReadOnlyContext.Provider value={control.readOnly}>
      <RadioGroupPrimitive.Root
        data-slot="radio-group"
        aria-labelledby={control.labelId}
        {...props}
        {...control.ariaProps}
        id={control.id}
        disabled={control.disabled}
        required={control.required}
        aria-readonly={control.readOnly || undefined}
        data-readonly={control.readOnly ? '' : undefined}
        className={cn('group/radio grid gap-2.5', className)}
      />
    </ReadOnlyContext.Provider>
  );
}

export function RadioGroupItem({
  className,
  onClick,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  const readOnly = useContext(ReadOnlyContext);
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      data-readonly={readOnly ? '' : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (readOnly) event.preventDefault();
      }}
      className={cn(
        checkControlClasses,
        'data-[state=checked]:border-accent rounded-full',
        'group-aria-invalid/radio:border-danger',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="bg-accent size-2 rounded-full"
      />
    </RadioGroupPrimitive.Item>
  );
}
