'use client';
// Feed filters (#49): level, kind, matter, date range and a search over summaries, all written to
// the URL (`?level=&kind=&matter=&from=&to=&q=`) so a reload or a shared link keeps them.
// `Auto-applied only` is the one-click preset for level L3. Below 1280 px they sit in a
// collapsible bar; from 1280 px they are the sticky rail on the left of the feed.
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import { PROPOSAL_KINDS } from '@causedeck/validators/proposal-draft';
import { SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type RefObject } from 'react';

import type { MatterSearchHit } from '../../app/(app)/w/[slug]/matters/actions.ts';
import type { Result } from '../../lib/safe-action.ts';

import {
  FEED_LEVELS,
  feedFilterQuery,
  hasFeedFilters,
  type FeedFilters,
  type FeedLevel,
} from './feed-params.ts';
import { MatterPicker } from './matter-picker.tsx';

const ALL = 'all';

export interface ActivityFiltersProps {
  workspaceId: string;
  filters: FeedFilters;
  disabled: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  searchMatters: (input: { workspaceId: string; q: string }) => Promise<Result<MatterSearchHit[]>>;
}

export function ActivityFilters({
  workspaceId,
  filters,
  disabled,
  searchRef,
  searchMatters,
}: ActivityFiltersProps) {
  const t = useTranslations('activity.filters');
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState(filters.q ?? '');

  const apply = (next: FeedFilters) => {
    const query = feedFilterQuery(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const autoOnly = filters.level === 'L3';

  return (
    <div data-slot="activity-filters" className="flex flex-col gap-3 xl:sticky xl:top-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="xl:hidden"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <SlidersHorizontal aria-hidden="true" />
          {t('toggle')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-pressed={autoOnly}
          disabled={disabled}
          onClick={() => {
            apply({ ...filters, level: autoOnly ? undefined : 'L3' });
          }}
        >
          {t('autoOnly')}
        </Button>
      </div>
      <form
        id={`${id}-panel`}
        role="search"
        aria-label={t('label')}
        className={`${open ? 'flex' : 'hidden'} flex-col gap-3 xl:flex`}
        onSubmit={(event) => {
          event.preventDefault();
          apply({ ...filters, q: q.trim() === '' ? undefined : q.trim() });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-q`}>{t('search')}</Label>
          <Input
            id={`${id}-q`}
            ref={searchRef}
            type="search"
            value={q}
            disabled={disabled}
            placeholder={t('searchPlaceholder')}
            aria-keyshortcuts="/"
            onChange={(event) => {
              setQ(event.target.value);
            }}
          />
          <p className="text-ink-muted text-xs">{t('searchHint')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-level`}>{t('level')}</Label>
          <Select
            value={filters.level ?? ALL}
            disabled={disabled}
            onValueChange={(value) => {
              apply({ ...filters, level: value === ALL ? undefined : (value as FeedLevel) });
            }}
          >
            <SelectTrigger id={`${id}-level`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('levelAll')}</SelectItem>
              {FEED_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-kind`}>{t('kind')}</Label>
          <Select
            value={filters.kind ?? ALL}
            disabled={disabled}
            onValueChange={(value) => {
              apply({ ...filters, kind: value === ALL ? undefined : value });
            }}
          >
            <SelectTrigger id={`${id}-kind`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('kindAll')}</SelectItem>
              {PROPOSAL_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('matter')}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            aria-haspopup="dialog"
            onClick={() => {
              setPicking(true);
            }}
          >
            {filters.matterName ?? (filters.matter === undefined ? t('matterAll') : t('matter'))}
          </Button>
        </div>
        {filters.capture === undefined ? null : (
          <p className="text-ink-muted text-xs">{t('captureOne')}</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-from`}>{t('from')}</Label>
            <Input
              id={`${id}-from`}
              type="date"
              value={filters.from ?? ''}
              disabled={disabled}
              onChange={(event) => {
                apply({ ...filters, from: event.target.value || undefined });
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-to`}>{t('to')}</Label>
            <Input
              id={`${id}-to`}
              type="date"
              value={filters.to ?? ''}
              disabled={disabled}
              onChange={(event) => {
                apply({ ...filters, to: event.target.value || undefined });
              }}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={disabled}>
            {t('apply')}
          </Button>
          {hasFeedFilters(filters) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setQ('');
                apply({});
              }}
            >
              {t('clear')}
            </Button>
          ) : null}
        </div>
      </form>
      {picking ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setPicking(false);
          }}
        >
          <DialogContent data-slot="activity-matter-filter">
            <DialogHeader>
              <DialogTitle>{t('matterPick')}</DialogTitle>
              <DialogDescription className="sr-only">{t('matterPick')}</DialogDescription>
            </DialogHeader>
            <MatterPicker
              workspaceId={workspaceId}
              search={searchMatters}
              selectedId={filters.matter}
              onSelect={(hit) => {
                setPicking(false);
                apply({ ...filters, matter: hit.id, matterName: hit.title });
              }}
            />
            {filters.matter === undefined ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPicking(false);
                  apply({ ...filters, matter: undefined, matterName: undefined });
                }}
              >
                {t('matterAll')}
              </Button>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
