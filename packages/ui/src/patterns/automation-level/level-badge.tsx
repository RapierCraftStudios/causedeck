import type { ComponentProps } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/tooltip';
import { cn } from '../../lib/cn';
import { LEVELS, type Level } from '../types';

export interface LevelMeta {
  /** Visible label. Never claims anything was sent; the lawyer does the sharing. */
  label: string;
  /** What the level means, shown in the tooltip and the legend. */
  description: string;
  /** Number of filled ladder steps (1-4). */
  step: number;
  /** Colour token, `--level-l1` ... `--level-l4`. */
  token: `--level-l${1 | 2 | 3 | 4}`;
  /** Literal utilities so Tailwind sees them: filled step and capsule edge. */
  fill: string;
  edge: string;
}

export const LEVEL_META: Record<Level, LevelMeta> = {
  L1: {
    label: 'Suggested',
    description: 'Lawyer OS suggests this. Nothing changes unless you act on it.',
    step: 1,
    token: '--level-l1',
    fill: 'bg-level-l1',
    edge: 'border-level-l1',
  },
  L2: {
    label: 'Needs your confirmation',
    description: 'Lawyer OS prepared this change. It applies only after you confirm it.',
    step: 2,
    token: '--level-l2',
    fill: 'bg-level-l2',
    edge: 'border-level-l2',
  },
  L3: {
    label: 'Applied, undo available',
    description: 'Lawyer OS applied this inside your workspace. You can undo it.',
    step: 3,
    token: '--level-l3',
    fill: 'bg-level-l3',
    edge: 'border-level-l3',
  },
  L4: {
    label: 'Draft for you to share',
    description: 'Lawyer OS drafted this for you. Only you can share it.',
    step: 4,
    token: '--level-l4',
    fill: 'bg-level-l4',
    edge: 'border-level-l4',
  },
};

export interface LevelLabels {
  /** Tooltip line when the badge links to how levels and privacy work. */
  learnMore: string;
  /** Accessible name of the badge. */
  badge: (level: Level, label: string) => string;
}

export const DEFAULT_LEVEL_LABELS: LevelLabels = {
  learnMore: 'Select to see how automation levels and privacy work.',
  badge: (level, label) => `Automation level ${level.slice(1)} of 4: ${label}`,
};

/** A 4-step ladder filled to the level: the level's icon, readable without colour. */
export function LevelLadder({ level, className }: { level: Level; className?: string }) {
  const meta = LEVEL_META[level];
  return (
    <span
      aria-hidden="true"
      data-slot="level-ladder"
      data-step={meta.step}
      className={cn('inline-flex h-3 items-end gap-px', className)}
    >
      {LEVELS.map((_, i) => (
        <span
          key={i}
          data-filled={i < meta.step ? '' : undefined}
          className={cn(
            'w-0.75 rounded-full forced-colors:border forced-colors:border-current',
            ['h-1', 'h-1.5', 'h-2', 'h-3'][i],
            i < meta.step ? cn(meta.fill, 'forced-colors:bg-[CanvasText]') : 'bg-line-strong',
          )}
        />
      ))}
    </span>
  );
}

export interface LevelBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** L1-L4 only. There is no L5: nothing is sent, filed or paid on the lawyer's behalf. */
  level: Level;
  /** Opens the privacy page explaining levels; the badge becomes a button when given. */
  onLearnMore?: (() => void) | undefined;
  labels?: Partial<LevelLabels>;
}

const capsule = [
  'inline-flex min-h-5 max-w-full shrink-0 items-center gap-1 rounded-full border bg-surface-raised',
  'px-1.5 text-start font-sans text-xs font-medium text-ink-muted',
  'forced-colors:border-current',
].join(' ');

/** Tiny capsule: ladder glyph, level label and its colour; the tooltip explains the level. */
export function LevelBadge({ level, onLearnMore, labels, className, ...props }: LevelBadgeProps) {
  const text = { ...DEFAULT_LEVEL_LABELS, ...labels };
  const meta = LEVEL_META[level];
  const content = (
    <>
      <LevelLadder level={level} />
      <span className="min-w-0 wrap-break-word">{meta.label}</span>
    </>
  );
  const shared = {
    'data-slot': 'level-badge',
    'data-level': level,
    className: cn(capsule, meta.edge, className),
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onLearnMore ? (
          <button
            type="button"
            {...shared}
            aria-label={text.badge(level, meta.label)}
            className={cn(
              shared.className,
              'focus-visible:outline-ring relative outline-offset-2 focus-visible:outline-2',
              'pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3',
            )}
            onClick={onLearnMore}
          >
            {content}
          </button>
        ) : (
          <span {...shared} {...props} tabIndex={0} aria-label={text.badge(level, meta.label)}>
            {content}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent data-slot="level-tooltip">
        {meta.description}
        {onLearnMore ? ` ${text.learnMore}` : ''}
      </TooltipContent>
    </Tooltip>
  );
}
