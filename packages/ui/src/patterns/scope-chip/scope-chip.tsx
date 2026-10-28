import { Briefcase, Lock, Users } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

export type MemoryVisibility = 'user' | 'workspace' | 'matter';

export interface ScopeChipLabels {
  user: string;
  workspace: string;
  matter: string;
}

export const DEFAULT_SCOPE_CHIP_LABELS: ScopeChipLabels = {
  user: 'Only you',
  workspace: 'Chamber',
  matter: 'This matter',
};

const ICONS = { user: Lock, workspace: Users, matter: Briefcase } as const;

export interface ScopeChipProps extends Omit<ComponentProps<'span'>, 'children'> {
  scope: MemoryVisibility;
  labels?: Partial<ScopeChipLabels> | undefined;
}

/** Who can see a memory. Privacy matters, so the scope is text and an icon, never colour alone. */
export function ScopeChip({ scope, labels, className, ...props }: ScopeChipProps) {
  const text = { ...DEFAULT_SCOPE_CHIP_LABELS, ...labels };
  const Icon = ICONS[scope];
  return (
    <span
      data-slot="scope-chip"
      data-scope={scope}
      className={cn(
        'border-line bg-surface text-ink inline-flex min-h-5.5 items-center gap-1 rounded-full border',
        'px-2 text-xs font-semibold forced-colors:border-current [&_svg]:size-3',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" />
      {text[scope]}
    </span>
  );
}
