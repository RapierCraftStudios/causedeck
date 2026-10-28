'use client';
// Filters and search (#68): matter, owner, kind, source and group plus a text search. They apply
// to the rows already loaded, so the queue narrows without a round trip.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';

import {
  OBLIGATION_KINDS,
  QUEUE_GROUP_ORDER,
  hasFilters,
  type QueueFilters,
} from '../../../../../../lib/obligations/queue-state.ts';

const SOURCES = ['manual', 'document', 'capture', 'adapter', 'ai', 'import', 'system'] as const;

export interface QueueFiltersProps {
  filters: QueueFilters;
  matters: { id: string; title: string }[];
  members: { id: string; name: string }[];
  searchRef: Ref<HTMLInputElement>;
  onChange: (next: QueueFilters) => void;
}

const selectClass =
  'border-line bg-surface text-ink focus-visible:ring-focus min-h-11 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none';

export function QueueFilterBar({
  filters,
  matters,
  members,
  searchRef,
  onChange,
}: QueueFiltersProps) {
  const t = useTranslations('obligations');
  const set = (key: keyof QueueFilters) => (value: string) => {
    onChange({ ...filters, [key]: value === '' ? undefined : value });
  };
  const pick = (
    key: Exclude<keyof QueueFilters, 'q'>,
    options: readonly { value: string; label: string }[],
  ) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-ink-muted">{t(`filters.${key}`)}</span>
      <select
        className={selectClass}
        value={filters[key] ?? ''}
        onChange={(event) => {
          set(key)(event.target.value);
        }}
      >
        <option value="">{t('filters.all')}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div role="search" aria-label={t('filters.label')} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
        <span className="text-ink-muted">{t('filters.search')}</span>
        <Input
          ref={searchRef}
          type="search"
          data-page-search=""
          value={filters.q ?? ''}
          placeholder={t('filters.searchPlaceholder')}
          onChange={(event) => {
            set('q')(event.target.value);
          }}
        />
      </label>
      {pick(
        'matter',
        matters.map((m) => ({ value: m.id, label: m.title })),
      )}
      {pick(
        'owner',
        members.map((m) => ({ value: m.id, label: m.name })),
      )}
      {pick(
        'kind',
        OBLIGATION_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })),
      )}
      {pick(
        'source',
        SOURCES.map((s) => ({ value: s, label: t(`sourceType.${s}`) })),
      )}
      {pick(
        'group',
        QUEUE_GROUP_ORDER.map((g) => ({ value: g, label: t(`groups.${g}`) })),
      )}
      {hasFilters(filters) ? (
        <Button
          variant="ghost"
          onClick={() => {
            onChange({});
          }}
        >
          {t('filters.clear')}
        </Button>
      ) : null}
    </div>
  );
}
