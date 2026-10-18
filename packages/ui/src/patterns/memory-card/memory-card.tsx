import { Check, CircleAlert, Pencil, Trash2 } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/button';
import { Skeleton, SkeletonGroup } from '../../components/skeleton';
import { cn } from '../../lib/cn';
import { ProvenanceChip } from '../provenance-chip/provenance-chip';
import type { Anchor, MemoryScope, ProvenanceSource } from '../types';

export interface MemoryScopeMeta {
  label: string;
  description: string;
}

/** The seven memory scopes (docs/product/10-lawyer-os-system-architecture.md). */
export const MEMORY_SCOPE_META: Record<MemoryScope, MemoryScopeMeta> = {
  M1: { label: 'Practice profile', description: 'Enrolment, courts, practice areas, languages.' },
  M2: { label: 'Working preferences', description: 'Brief format, reminders, update tone.' },
  M3: { label: 'Matter memory', description: 'Key facts, dates and instructions for a matter.' },
  M4: { label: 'Court notes', description: 'Your private notes on halls and registry practice.' },
  M5: { label: 'Playbooks', description: 'Your templates, prayers and reusable passages.' },
  M6: { label: 'Relationships', description: 'How existing clients and contacts like updates.' },
  M7: { label: 'Recognition', description: 'Aliases and shorthand Lawyer OS should recognise.' },
};

export interface MemoryLabels {
  confirm: string;
  edit: string;
  delete: string;
  /** Accessible names that say which memory the action applies to. */
  action: (action: string, title: string) => string;
  offline: string;
  viewOnly: string;
}

export const DEFAULT_MEMORY_LABELS: MemoryLabels = {
  confirm: 'Confirm',
  edit: 'Edit',
  delete: 'Delete',
  action: (action, title) => `${action} memory: ${title}`,
  offline: 'You are offline. Changes return when you are back online.',
  viewOnly: 'View only',
};

export interface MemoryCardProps extends Omit<ComponentProps<'article'>, 'children' | 'title'> {
  scope: MemoryScope;
  /** What is remembered: `Court Hall 12`, `Next hearing`. */
  title: string;
  value: string;
  source: ProvenanceSource;
  anchor?: Anchor | undefined;
  /** Shown only while the memory is proposed: Lawyer OS never saves memory without you. */
  onConfirm?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onOpenSource?: (() => void) | undefined;
  offline?: boolean | undefined;
  viewOnly?: boolean | undefined;
  error?: string | undefined;
  scopeLabel?: string | undefined;
  labels?: Partial<MemoryLabels> | undefined;
}

/** One remembered fact: its scope (M1-M7), value and source, with confirm, edit and delete. */
export function MemoryCard({
  scope,
  title,
  value,
  source,
  anchor,
  onConfirm,
  onEdit,
  onDelete,
  onOpenSource,
  offline = false,
  viewOnly = false,
  error,
  scopeLabel,
  labels,
  className,
  ...props
}: MemoryCardProps) {
  const text = { ...DEFAULT_MEMORY_LABELS, ...labels };
  const meta = MEMORY_SCOPE_META[scope];
  const proposed = source.state === 'proposed';

  return (
    <article
      data-slot="memory-card"
      data-scope={scope}
      data-source-state={source.state}
      aria-label={title}
      className={cn(
        'border-line bg-surface-raised flex flex-col gap-3 rounded-xl border p-4 font-sans',
        proposed && 'border-s-level-l2 border-s-3',
        className,
      )}
      {...props}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          data-slot="memory-scope"
          title={meta.description}
          className={cn(
            'border-line bg-surface-sunken text-ink-muted inline-flex h-5.5 shrink-0 items-center',
            'gap-1 rounded-full border px-2 text-xs font-medium forced-colors:border-current',
          )}
        >
          <span className="text-ink tabular-nums">{scope}</span>
          <span aria-hidden="true">·</span>
          {scopeLabel ?? meta.label}
        </span>
        <h3 className="text-ink min-w-0 truncate text-sm font-medium">{title}</h3>
      </header>
      <p data-slot="memory-value" className="text-ink text-base break-words">
        {value}
      </p>
      {error === undefined ? null : (
        <p
          role="alert"
          data-slot="memory-error"
          className="text-danger flex items-center gap-1 text-xs [&_svg]:size-3.5"
        >
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      )}
      <footer className="flex flex-wrap items-center gap-2">
        <ProvenanceChip
          source={source}
          anchor={anchor}
          onOpenSource={onOpenSource}
          offline={offline}
          viewOnly={viewOnly}
        />
        {viewOnly ? (
          <span data-slot="memory-view-only" className="text-ink-subtle ms-auto text-xs">
            {text.viewOnly}
          </span>
        ) : (
          <div data-slot="memory-actions" className="ms-auto flex flex-wrap items-center gap-1">
            {offline ? (
              <span data-slot="memory-offline" className="text-ink-subtle text-xs">
                {text.offline}
              </span>
            ) : null}
            {proposed && onConfirm ? (
              <Button
                size="sm"
                disabled={offline}
                aria-label={text.action(text.confirm, title)}
                onClick={onConfirm}
              >
                <Check aria-hidden="true" />
                {text.confirm}
              </Button>
            ) : null}
            {onEdit ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={offline}
                aria-label={text.action(text.edit, title)}
                onClick={onEdit}
              >
                <Pencil aria-hidden="true" />
                {text.edit}
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={offline}
                aria-label={text.action(text.delete, title)}
                onClick={onDelete}
              >
                <Trash2 aria-hidden="true" />
                {text.delete}
              </Button>
            ) : null}
          </div>
        )}
      </footer>
    </article>
  );
}

/** Placeholder while memory loads. */
export function MemoryCardSkeleton() {
  return (
    <SkeletonGroup data-slot="memory-skeleton" className="border-line gap-3 rounded-xl border p-4">
      <Skeleton className="h-5 w-40 rounded-full" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-6 w-28 rounded-full" />
    </SkeletonGroup>
  );
}
