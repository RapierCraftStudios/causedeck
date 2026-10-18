'use client';

import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { createContext, useContext, type ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from '../field/field';
import { toggleVariants, type ToggleSize, type ToggleVariant } from '../toggle/toggle';

interface ToggleGroupStyle {
  variant: ToggleVariant;
  size: ToggleSize;
}

const ToggleGroupContext = createContext<ToggleGroupStyle>({ variant: 'outline', size: 'md' });

export type ToggleGroupProps = ComponentProps<typeof ToggleGroupPrimitive.Root> & {
  variant?: ToggleVariant;
  size?: ToggleSize;
};

/** A set of toggles: `type="single"` (one pressed) or `type="multiple"`. */
export function ToggleGroup({
  variant = 'outline',
  size = 'md',
  className,
  children,
  ...props
}: ToggleGroupProps) {
  const control = useFieldControl(props);
  return (
    <ToggleGroupContext.Provider value={{ variant, size }}>
      <ToggleGroupPrimitive.Root
        data-slot="toggle-group"
        data-variant={variant}
        data-size={size}
        aria-labelledby={control.labelId}
        {...props}
        {...control.ariaProps}
        aria-required={undefined}
        id={control.id}
        disabled={control.disabled}
        className={cn(
          'group/toggle-group inline-flex w-fit items-center gap-1 rounded-md',
          'aria-invalid:outline-danger aria-invalid:outline-1 aria-invalid:outline-offset-2',
          className,
        )}
      >
        {children}
      </ToggleGroupPrimitive.Root>
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  const { variant, size } = useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  );
}
