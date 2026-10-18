'use client';

import { CircleAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from '../field/field';
import { Spinner } from '../spinner/spinner';

/**
 * Shared text-control look (Input, Textarea, Select and Combobox triggers): `--surface-raised`
 * fill, 1 px `--line-strong` border, 2 px `--ring` outline (offset 2) plus an `--accent` border on
 * focus, `--danger` border when invalid, sunken fill when read-only.
 */
export const controlClasses = [
  'w-full min-w-0 rounded-md border border-line-strong bg-surface-raised px-3',
  'font-sans text-sm text-ink placeholder:text-ink-subtle',
  'transition-colors duration-(--dur-fast) ease-standard motion-reduce:transition-none',
  'hover:border-line-control',
  'outline-offset-2 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-ring',
  'aria-invalid:border-danger aria-invalid:hover:border-danger aria-invalid:focus-visible:border-danger',
  'data-readonly:bg-surface-sunken data-readonly:hover:border-line-strong',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'forced-colors:border-current',
].join(' ');

/** 36 px tall; 44 px minimum on touch (`--hit`). */
export const controlHeight = 'h-9 pointer-coarse:min-h-11';

export interface InputLabels {
  /** Announced while `loading`. */
  loading: string;
}

export const DEFAULT_INPUT_LABELS: InputLabels = { loading: 'Loading' };

export interface InputProps extends ComponentProps<'input'> {
  /** Decorative icon at the start (inline-start in RTL). */
  startIcon?: ReactNode | undefined;
  /** Decorative icon at the end; replaced by the invalid icon while invalid. */
  endIcon?: ReactNode | undefined;
  /** Show a spinner at the end and mark the input `aria-busy`. */
  loading?: boolean | undefined;
  labels?: Partial<InputLabels> | undefined;
}

/** Single-line text input; wires itself to a surrounding `Field`. */
export function Input({
  startIcon,
  endIcon,
  loading = false,
  labels,
  className,
  type = 'text',
  ...props
}: InputProps) {
  const control = useFieldControl(props);
  const text = { ...DEFAULT_INPUT_LABELS, ...labels };
  const end = loading ? (
    <Spinner size="md" labels={{ loading: text.loading }} />
  ) : control.invalid ? (
    <CircleAlert aria-hidden="true" className="text-danger" />
  ) : (
    endIcon
  );

  return (
    <span data-slot="input-wrapper" className="relative flex w-full min-w-0 items-center">
      {startIcon ? (
        <span
          aria-hidden="true"
          className="text-ink-muted pointer-events-none absolute start-3 inline-flex [&_svg]:size-4"
        >
          {startIcon}
        </span>
      ) : null}
      <input
        data-slot="input"
        type={type}
        {...props}
        {...control.ariaProps}
        id={control.id}
        disabled={control.disabled}
        readOnly={control.readOnly}
        required={control.required}
        aria-busy={loading || undefined}
        data-readonly={control.readOnly ? '' : undefined}
        className={cn(
          controlClasses,
          controlHeight,
          'py-1',
          startIcon ? 'ps-9' : null,
          end ? 'pe-9' : null,
          'file:text-ink file:border-0 file:bg-transparent file:font-medium',
          className,
        )}
      />
      {end ? (
        <span
          data-slot="input-end"
          className="text-ink-muted pointer-events-none absolute end-3 inline-flex [&_svg]:size-4"
        >
          {end}
        </span>
      ) : null}
    </span>
  );
}
