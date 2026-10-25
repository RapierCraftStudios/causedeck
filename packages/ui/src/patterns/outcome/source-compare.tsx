'use client';

import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

export interface CompareSide {
  /** `Current` or `Proposed`, as the caller words it. */
  label: string;
  value: string;
  /** Provenance chip or text for where this value comes from. */
  source: ReactNode;
  /** The action's own name, for example `Keep this date`. */
  chooseLabel: string;
}

export interface SourceCompareProps extends Omit<ComponentProps<'section'>, 'title' | 'onSelect'> {
  title: string;
  current: CompareSide;
  proposed: CompareSide;
  /** Which side the lawyer picked, if any; until then nothing changes. */
  chosen?: 'current' | 'proposed' | undefined;
  onChoose: (side: 'current' | 'proposed') => void;
  disabled?: boolean | undefined;
}

/** Two values that disagree, side by side with their sources; the lawyer picks one. */
export function SourceCompare({
  title,
  current,
  proposed,
  chosen,
  onChoose,
  disabled = false,
  className,
  ...props
}: SourceCompareProps) {
  const sides = [
    ['current', current],
    ['proposed', proposed],
  ] as const;
  return (
    <section
      data-slot="source-compare"
      aria-label={title}
      className={cn('border-border bg-card grid gap-3 rounded-lg border p-4', className)}
      {...props}
    >
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {sides.map(([key, side]) => (
          <div
            key={key}
            role="group"
            aria-label={side.label}
            data-chosen={chosen === key ? '' : undefined}
            className="border-border grid gap-2 rounded-md border p-3 data-[chosen]:border-primary"
          >
            <p className="text-muted-foreground text-xs">{side.label}</p>
            <p className="text-base font-medium tabular-nums">{side.value}</p>
            <div>{side.source}</div>
            <Button
              type="button"
              variant={chosen === key ? 'default' : 'outline'}
              aria-pressed={chosen === key}
              disabled={disabled}
              onClick={() => {
                onChoose(key);
              }}
            >
              {side.chooseLabel}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
