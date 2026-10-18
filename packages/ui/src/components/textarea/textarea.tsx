'use client';

import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from '../field/field';
import { controlClasses } from '../input/input';

export type TextareaProps = ComponentProps<'textarea'>;

/** Multi-line text input with the Input look; grows with its content. */
export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  const control = useFieldControl(props);
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      {...props}
      {...control.ariaProps}
      id={control.id}
      disabled={control.disabled}
      readOnly={control.readOnly}
      required={control.required}
      data-readonly={control.readOnly ? '' : undefined}
      className={cn(controlClasses, 'field-sizing-content min-h-20 resize-y py-2', className)}
    />
  );
}
