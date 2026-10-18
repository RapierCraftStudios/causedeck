import type { ComponentProps } from 'react';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';
import { LEVELS } from '../types';
import { LEVEL_META, LevelLadder } from './level-badge';

export interface LevelLegendLabels {
  title: string;
  learnMore: string;
}

export const DEFAULT_LEVEL_LEGEND_LABELS: LevelLegendLabels = {
  title: 'Automation levels',
  learnMore: 'How levels and privacy work',
};

export interface LevelLegendProps extends ComponentProps<'section'> {
  onLearnMore?: (() => void) | undefined;
  labels?: Partial<LevelLegendLabels>;
}

/** Every level with its ladder, label and meaning. */
export function LevelLegend({ onLearnMore, labels, className, ...props }: LevelLegendProps) {
  const text = { ...DEFAULT_LEVEL_LEGEND_LABELS, ...labels };
  return (
    <section
      data-slot="level-legend"
      aria-label={text.title}
      className={cn('flex flex-col gap-3 text-sm', className)}
      {...props}
    >
      <ul className="flex flex-col gap-2">
        {LEVELS.map((level) => {
          const meta = LEVEL_META[level];
          return (
            <li key={level} data-level={level} className="flex items-start gap-2">
              <LevelLadder level={level} className="mt-1" />
              <span className="flex flex-col">
                <span className="text-ink font-medium">
                  {level} · {meta.label}
                </span>
                <span className="text-ink-muted">{meta.description}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {onLearnMore ? (
        <Button variant="link" size="sm" className="self-start" onClick={onLearnMore}>
          {text.learnMore}
        </Button>
      ) : null}
    </section>
  );
}
