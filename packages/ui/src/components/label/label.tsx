import { Label as LabelPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export interface LabelLabels {
  /** Screen-reader text after a required label; the visible mark is an asterisk. */
  required: string;
}

export const DEFAULT_LABEL_LABELS: LabelLabels = { required: 'required' };

export interface LabelProps extends ComponentProps<typeof LabelPrimitive.Root> {
  /** Show the required mark (asterisk plus screen-reader text). */
  required?: boolean;
  labels?: Partial<LabelLabels> | undefined;
}

/** Text label for a form control. Clicking it focuses the control named by `htmlFor`. */
export function Label({ required = false, labels, className, children, ...props }: LabelProps) {
  const text = { ...DEFAULT_LABEL_LABELS, ...labels };
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'text-ink inline-flex items-center gap-1.5 font-sans text-sm font-medium select-none',
        '[&_svg]:text-ink-muted [&_svg]:size-4 [&_svg]:shrink-0',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="text-danger">
            *
          </span>
          <span className="sr-only"> {text.required}</span>
        </>
      ) : null}
    </LabelPrimitive.Root>
  );
}
