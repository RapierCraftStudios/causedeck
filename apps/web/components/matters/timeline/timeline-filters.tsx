'use client';
// The Timeline's filters (#41): event kinds (multi-select toggles), the proceedings chosen in the
// tree (shown here as removable chips; at 768 px the same chips are the way to choose), a date
// range, `Show proposed`, and a text search. All of it is URL state held by `useTimelineState`;
// `Clear filters` is one action that puts every filter back. Below `md` the panel opens in a bottom
// Sheet. Every control is at least 44 px tall on touch.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import type { GraphNodeView } from '../../../lib/matters/timeline.ts';
import type { TimelineKind } from '../../../lib/matters/timeline-tab.ts';
import { cn } from '../matter-card.tsx';

import { isFiltered, type TimelineQuery } from './use-timeline-state.ts';

export const KIND_LABEL_KEYS = {
  listing: 'kinds.listing',
  hearing: 'kinds.hearing',
  order: 'kinds.order',
  obligation_due: 'kinds.obligation_due',
  obligation_closed: 'kinds.obligation_closed',
  state_change: 'kinds.state_change',
  document_added: 'kinds.document_added',
  bench_change: 'kinds.bench_change',
} as const satisfies Record<TimelineKind, string>;

const chip = [
  'inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-sm',
  'pointer-coarse:min-h-11 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
].join(' ');

export interface TimelineFiltersProps {
  query: TimelineQuery;
  /** The kinds this member may see. */
  kinds: readonly TimelineKind[];
  nodes: readonly Pick<GraphNodeView, 'id' | 'label'>[];
  onChange: (patch: Partial<TimelineQuery>) => void;
  onClear: () => void;
  className?: string;
}

export function TimelineFilters({
  query,
  kinds,
  nodes,
  onChange,
  onClear,
  className,
}: TimelineFiltersProps) {
  const t = useTranslations('matterTimeline');
  const base = useId();
  const active = new Set<string>(query.k);
  const toggleKind = (kind: TimelineKind) => {
    const next = active.has(kind) ? query.k.filter((k) => k !== kind) : [...query.k, kind];
    onChange({ k: next });
  };
  const chosen = nodes.filter((node) => query.p.includes(node.id));
  return (
    <div data-slot="timeline-filters" className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${base}-q`} className="text-ink-muted text-xs font-medium">
          {t('filters.search')}
        </label>
        <Input
          id={`${base}-q`}
          type="search"
          value={query.q}
          maxLength={200}
          onChange={(event) => {
            onChange({ q: event.target.value });
          }}
        />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-ink-muted mb-1 text-xs font-medium">{t('filters.kinds')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {kinds.map((kind) => {
            const on = active.has(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  toggleKind(kind);
                }}
                className={cn(chip, on ? 'border-accent bg-accent-soft' : 'border-line-strong')}
              >
                {on ? <Check aria-hidden="true" className="size-3.5" /> : null}
                {t(KIND_LABEL_KEYS[kind])}
              </button>
            );
          })}
        </div>
      </fieldset>
      {chosen.length > 0 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-ink-muted mb-1 text-xs font-medium">
            {t('filters.proceedings')}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {chosen.map((node) => (
              <button
                key={node.id}
                type="button"
                aria-label={t('filters.removeProceeding', { label: node.label })}
                onClick={() => {
                  onChange({ p: query.p.filter((id) => id !== node.id) });
                }}
                className={cn(chip, 'border-accent bg-accent-soft tabular-nums')}
              >
                {node.label}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="text-ink-muted mb-1 text-xs font-medium">{t('filters.dates')}</legend>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-muted">{t('filters.from')}</span>
          <Input
            type="date"
            value={query.from}
            max={query.to === '' ? undefined : query.to}
            onChange={(event) => {
              onChange({ from: event.target.value });
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-muted">{t('filters.to')}</span>
          <Input
            type="date"
            value={query.to}
            min={query.from === '' ? undefined : query.from}
            onChange={(event) => {
              onChange({ to: event.target.value });
            }}
          />
        </label>
      </fieldset>
      <label className="flex min-h-8 items-center gap-2 text-sm pointer-coarse:min-h-11">
        <input
          type="checkbox"
          checked={query.proposed}
          onChange={(event) => {
            onChange({ proposed: event.target.checked });
          }}
          className="size-4"
        />
        {t('filters.showProposed')}
      </label>
      {isFiltered(query) ? (
        <Button variant="outline" onClick={onClear} className="self-start pointer-coarse:min-h-11">
          {t('filters.clear')}
        </Button>
      ) : null}
    </div>
  );
}

export interface ProceedingChipsProps {
  nodes: readonly Pick<GraphNodeView, 'id' | 'label'>[];
  selected: readonly string[];
  onSelect: (id: string, additive: boolean) => void;
  onClear: () => void;
}

/** The 768 px stand-in for the tree: a scrollable row of proceeding chips, selected = filled. */
export function ProceedingChips({ nodes, selected, onSelect, onClear }: ProceedingChipsProps) {
  const t = useTranslations('matterTimeline');
  return (
    <div
      role="group"
      aria-label={t('graph.chipsLabel')}
      className="flex gap-1.5 overflow-x-auto pb-1"
    >
      <button
        type="button"
        aria-pressed={selected.length === 0}
        onClick={onClear}
        className={cn(
          chip,
          'shrink-0',
          selected.length === 0 ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
        )}
      >
        {t('graph.allProceedings')}
      </button>
      {nodes.map((node) => {
        const on = selected.includes(node.id);
        return (
          <button
            key={node.id}
            type="button"
            aria-pressed={on}
            onClick={(event) => {
              onSelect(node.id, event.shiftKey);
            }}
            className={cn(
              chip,
              'shrink-0 tabular-nums',
              on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
            )}
          >
            {node.label}
          </button>
        );
      })}
    </div>
  );
}
