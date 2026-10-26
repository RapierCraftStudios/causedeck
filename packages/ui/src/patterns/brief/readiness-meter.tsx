import { Check } from 'lucide-react';

import { cn } from '../../lib/cn';

export interface ReadinessMeterSegment {
  key: string;
  label: string;
  met: boolean;
}

export interface ReadinessMeterProps {
  /** 0-100. */
  score: number;
  /** The four ticks, in order. */
  segments: readonly ReadinessMeterSegment[];
  /** Text equivalent: 'Ready 75 of 100'. */
  label: string;
  className?: string;
}

/** The four-tick readiness meter; the text equivalent is the accessible name, never colour alone. */
export function ReadinessMeter({ score, segments, label, className }: ReadinessMeterProps) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      aria-valuetext={label}
      data-slot="readiness-meter"
      className={cn('inline-flex items-center gap-1.5 font-sans text-xs', className)}
    >
      <ul className="flex gap-1">
        {segments.map((segment) => (
          <li
            key={segment.key}
            title={segment.label}
            data-met={segment.met}
            className={cn(
              'flex size-4 items-center justify-center rounded-sm border',
              segment.met ? 'bg-seal border-seal text-white' : 'border-border',
            )}
          >
            {segment.met ? <Check aria-hidden="true" className="size-3" /> : null}
            <span className="sr-only">{`${segment.label}: ${segment.met ? '✓' : '–'}`}</span>
          </li>
        ))}
      </ul>
      <span className="tabular-nums">{label}</span>
    </div>
  );
}
