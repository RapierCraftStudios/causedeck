import { CircleAlert, RotateCw } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

export interface ErrorStateLabels {
  retry: string;
  support: string;
}

export const DEFAULT_ERROR_STATE_LABELS: ErrorStateLabels = {
  retry: 'Try again',
  support: 'Contact support',
};

export interface ErrorStateProps extends Omit<ComponentProps<'div'>, 'title' | 'children'> {
  /** What happened, in one plain sentence, e.g. `Could not load the cause list.` */
  title: string;
  /** Optional detail: what was kept and what to do next. */
  description?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Where to reach support; a link is shown when given. */
  supportHref?: string | undefined;
  labels?: Partial<ErrorStateLabels> | undefined;
}

/** Something failed: what happened, `Try again` and a support link. Announced at once. */
export function ErrorState({
  title,
  description,
  onRetry,
  supportHref,
  labels,
  className,
  ...props
}: ErrorStateProps) {
  const text = { ...DEFAULT_ERROR_STATE_LABELS, ...labels };
  return (
    <div
      role="alert"
      data-slot="pattern-error"
      data-pattern-state="error"
      className={cn(
        'border-danger bg-danger-soft text-ink flex flex-col items-center gap-4 rounded-xl border',
        'px-6 py-8 text-center font-sans',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="bg-surface-raised text-danger flex size-10 items-center justify-center rounded-full [&_svg]:size-5"
      >
        <CircleAlert />
      </span>
      <div className="grid max-w-prose gap-1">
        <p data-slot="pattern-error-title" className="text-base font-medium wrap-break-word">
          {title}
        </p>
        {description === undefined ? null : (
          <p className="text-ink-muted text-sm text-balance wrap-break-word">{description}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry ? (
          <Button onClick={onRetry}>
            <RotateCw aria-hidden="true" />
            {text.retry}
          </Button>
        ) : null}
        {supportHref === undefined ? null : (
          <a
            href={supportHref}
            data-slot="pattern-error-support"
            className="text-ink focus-visible:outline-ring rounded-sm text-sm font-medium underline underline-offset-4 outline-offset-2 focus-visible:outline-2"
          >
            {text.support}
          </a>
        )}
      </div>
    </div>
  );
}
