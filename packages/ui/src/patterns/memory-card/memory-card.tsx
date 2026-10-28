import { Check, CircleAlert, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

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
  /** The dimmed-card label of a paused memory. */
  paused: string;
  pause: string;
  resume: string;
}

export const DEFAULT_MEMORY_LABELS: MemoryLabels = {
  confirm: 'Confirm',
  edit: 'Edit',
  delete: 'Delete',
  action: (action, title) => `${action} memory: ${title}`,
  offline: 'You are offline. Changes return when you are back online.',
  viewOnly: 'View only',
  paused: 'Paused',
  pause: 'Pause',
  resume: 'Resume',
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
  /** A paused memory is dimmed, labelled and not used; `onPause` toggles it. */
  paused?: boolean | undefined;
  onPause?: (() => void) | undefined;
  /** Who can see it (a `ScopeChip`), shown beside the layer pill. */
  scopeChip?: ReactNode;
  /** When it was last used, already formatted by the caller. */
  lastUsed?: string | undefined;
  /** Where it was used (a "Used in" trigger). */
  usedIn?: ReactNode;
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
  paused = false,
  onPause,
  scopeChip,
  lastUsed,
  usedIn,
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
      data-paused={paused ? '' : undefined}
      aria-label={title}
      className={cn(
        'border-line bg-surface-raised flex flex-col gap-3 rounded-xl border p-4 font-sans',
        proposed && 'border-s-level-l2 border-s-3',
        paused && 'bg-surface-sunken',
        className,
      )}
      {...props}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          data-slot="memory-scope"
          title={meta.description}
          className={cn(
            'border-line bg-surface-sunken text-ink-muted inline-flex min-h-5.5 max-w-full items-center',
            'gap-1 rounded-full border px-2 text-xs font-medium forced-colors:border-current',
          )}
        >
          <span className="text-ink tabular-nums">{scope}</span>
          <span aria-hidden="true">·</span>
          {scopeLabel ?? meta.label}
        </span>
        {scopeChip}
        {paused ? (
          <span data-slot="memory-paused" className="text-ink-muted text-xs font-medium">
            {text.paused}
          </span>
        ) : null}
        <h3 className="text-ink min-w-0 text-sm font-medium wrap-break-word">{title}</h3>
      </header>
      <p
        data-slot="memory-value"
        className={cn('text-ink text-base wrap-anywhere', paused && 'opacity-70')}
      >
        {value}
      </p>
      {lastUsed === undefined && usedIn === undefined ? null : (
        <p
          data-slot="memory-usage-meta"
          className="text-ink-muted flex flex-wrap items-center gap-2 text-xs"
        >
          {lastUsed === undefined ? null : <span>{lastUsed}</span>}
          {usedIn}
        </p>
      )}
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
            {onPause ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={offline}
                aria-pressed={paused}
                aria-label={text.action(paused ? text.resume : text.pause, title)}
                onClick={onPause}
              >
                {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                {paused ? text.resume : text.pause}
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
