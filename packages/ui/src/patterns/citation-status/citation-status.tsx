import { CircleCheckBig, CircleHelp, SearchX, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/cn';

/** Mirrors the drafting citation check outcomes; kept local so the UI package does not import core. */
export type CitationStatusKind = 'verified' | 'not_found' | 'unknown';

export const CITATION_STATUS_ORDER: readonly CitationStatusKind[] = [
  'verified',
  'not_found',
  'unknown',
];

export interface CitationStatusMeta {
  /** Default English label; pass `label` to translate. */
  label: string;
  Icon: LucideIcon;
  /** Literal utilities so Tailwind sees them. */
  classes: string;
}

export const CITATION_STATUS_MAP: Record<CitationStatusKind, CitationStatusMeta> = {
  verified: {
    label: 'Verified',
    Icon: CircleCheckBig,
    classes: 'bg-success-soft text-success',
  },
  not_found: {
    label: 'Not found',
    Icon: SearchX,
    classes: 'bg-danger-soft text-danger',
  },
  unknown: {
    label: 'Unknown',
    Icon: CircleHelp,
    classes: 'bg-surface-sunken text-ink-muted',
  },
};

export interface CitationStatusProps extends Omit<ComponentProps<'span'>, 'children'> {
  status: CitationStatusKind;
  /** Override the plain-language label (translations). */
  label?: string;
}

/** Capsule like the provenance chip: glyph plus text label, so the status never rests on colour alone. */
export function CitationStatus({ status, label, className, ...props }: CitationStatusProps) {
  const meta = CITATION_STATUS_MAP[status];
  const { Icon } = meta;
  return (
    <span
      data-slot="citation-status"
      data-status={status}
      className={cn(
        'inline-flex min-h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2',
        'border-line border font-sans text-xs font-medium',
        'forced-colors:border-current [&_svg]:size-3 [&_svg]:shrink-0',
        meta.classes,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" data-slot="citation-status-icon" />
      <span className="min-w-0 wrap-break-word">{label ?? meta.label}</span>
    </span>
  );
}
