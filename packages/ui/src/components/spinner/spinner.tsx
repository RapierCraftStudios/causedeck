import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import './spinner.css';

export interface SpinnerLabels {
  /** Accessible name announced by the status role. */
  loading: string;
}

export const DEFAULT_SPINNER_LABELS: SpinnerLabels = { loading: 'Loading' };

const SIZES = { sm: 'size-3.5', md: 'size-4', lg: 'size-5' } as const;

export type SpinnerSize = keyof typeof SIZES;

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  size?: SpinnerSize;
  labels?: Partial<SpinnerLabels>;
  /** Hide from assistive tech when a parent already announces the busy state. */
  decorative?: boolean;
}

/** Indeterminate progress indicator in the current text colour. */
export function Spinner({
  size = 'md',
  labels,
  decorative = false,
  className,
  ...props
}: SpinnerProps) {
  const text = { ...DEFAULT_SPINNER_LABELS, ...labels };
  return (
    <span
      data-slot="spinner"
      role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : text.loading}
      aria-hidden={decorative ? true : undefined}
      className={cn('inline-flex shrink-0 text-current', SIZES[size], className)}
      {...props}
    >
      <svg
        className="cd-spinner size-full"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
