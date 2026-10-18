import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';
import type { Stage } from '../types';
import { STAGE_MAP } from './stage-map';

export interface StageBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  stage: Stage;
  /** Override the plain-language label (translations). */
  label?: string;
}

/** 22 px capsule: stage icon and label on the stage's soft colour. */
export function StageBadge({ stage, label, className, ...props }: StageBadgeProps) {
  const meta = STAGE_MAP[stage];
  const { Icon } = meta;
  return (
    <span
      data-slot="stage-badge"
      data-stage={stage}
      className={cn(
        'inline-flex h-5.5 max-w-full shrink-0 items-center gap-1 rounded-full px-2',
        'border border-transparent font-sans text-xs font-medium whitespace-nowrap',
        'forced-colors:border-current [&_svg]:size-3 [&_svg]:shrink-0',
        meta.classes,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" data-slot="stage-icon" />
      <span className="min-w-0 truncate">{label ?? meta.label}</span>
    </span>
  );
}
