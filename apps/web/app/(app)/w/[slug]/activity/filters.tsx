'use client';
// Audit feed filters (#232): date range, actor and action group as chips. Each chip is a button
// (`aria-expanded`) opening a sheet; applying writes the URL (`?from=&to=&actor=&action=`, days in
// IST, `to` inclusive, beside `tab=security`), so the server page re-reads the feed and a reload
// keeps the filters.
import { Button } from '@causedeck/ui/button';
import { Calendar, IST_TIME_ZONE, type DateRange } from '@causedeck/ui/calendar';
import { useMediaQuery } from '@causedeck/ui/hooks';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { ChevronDown } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import {
  ACTION_GROUPS,
  auditFilterQuery,
  istDay,
  type AuditFilterValues,
} from './filter-params.ts';

export interface AuditMember {
  memberId: string;
  userId: string;
  name: string;
}

const ALL = 'all';

function dayDate(day: string): Date {
  return new Date(`${day}T12:00:00+05:30`);
}

type Open = 'date' | 'actor' | 'action' | null;

function Chip({
  label,
  value,
  expanded,
  controls,
  disabled,
  onClick,
}: {
  label: string;
  value: string;
  expanded: boolean;
  controls: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      data-slot="audit-filter-chip"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      aria-haspopup="dialog"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="text-ink-muted">{label}:</span> {value}
      <ChevronDown aria-hidden="true" />
    </Button>
  );
}

export function AuditFilters({
  filters,
  members,
  disabled = false,
}: {
  filters: AuditFilterValues;
  members: readonly AuditMember[];
  disabled?: boolean;
}) {
  const t = useTranslations('audit.filters');
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const narrow = useMediaQuery('(max-width: 767px)');
  const id = useId();
  const [open, setOpen] = useState<Open>(null);
  const [range, setRange] = useState<DateRange | undefined>();
  const [actor, setActor] = useState(filters.actor ?? ALL);
  const [action, setAction] = useState(filters.action ?? ALL);

  const apply = (next: AuditFilterValues) => {
    // The security view is `?tab=security` beside the automation feed (#49): keep it.
    const params = new URLSearchParams(auditFilterQuery(next));
    params.set('tab', 'security');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setOpen(null);
  };

  const show = (which: Open) => {
    if (which === 'date') {
      setRange(
        filters.from
          ? { from: dayDate(filters.from), to: filters.to ? dayDate(filters.to) : undefined }
          : undefined,
      );
    }
    if (which === 'actor') setActor(filters.actor ?? ALL);
    if (which === 'action') setAction(filters.action ?? ALL);
    setOpen(which);
  };

  const day = (value: string) =>
    format.dateTime(dayDate(value), { dateStyle: 'medium', timeZone: IST_TIME_ZONE });
  const dateValue = filters.from
    ? filters.to
      ? t('dateRange', { from: day(filters.from), to: day(filters.to) })
      : t('dateFrom', { from: day(filters.from) })
    : t('dateAll');
  const actorValue =
    members.find((m) => m.userId === filters.actor)?.name ??
    (filters.actor ? filters.actor.slice(0, 8) : t('actorAll'));
  const groupLabel = (group: string) =>
    (ACTION_GROUPS as readonly string[]).includes(group)
      ? t(`groups.${group as (typeof ACTION_GROUPS)[number]}`)
      : group;
  const actionValue = filters.action ? groupLabel(filters.action) : t('actionAll');
  const any = Boolean(filters.from ?? filters.to ?? filters.actor ?? filters.action);
  const side = narrow ? 'bottom' : 'end';
  const sheetId = `${id}-sheet`;

  return (
    <div role="group" aria-label={t('label')} className="flex flex-wrap items-center gap-2">
      <Chip
        label={t('date')}
        value={dateValue}
        expanded={open === 'date'}
        controls={sheetId}
        disabled={disabled}
        onClick={() => {
          show('date');
        }}
      />
      <Chip
        label={t('actor')}
        value={actorValue}
        expanded={open === 'actor'}
        controls={sheetId}
        disabled={disabled}
        onClick={() => {
          show('actor');
        }}
      />
      <Chip
        label={t('action')}
        value={actionValue}
        expanded={open === 'action'}
        controls={sheetId}
        disabled={disabled}
        onClick={() => {
          show('action');
        }}
      />
      {any ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            apply({});
          }}
        >
          {t('clear')}
        </Button>
      ) : null}

      <Sheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        <SheetContent id={sheetId} side={side} data-slot="audit-filter-sheet">
          {open === 'date' ? (
            <>
              <SheetHeader>
                <SheetTitle>{t('date')}</SheetTitle>
                <SheetDescription>{t('dateHint')}</SheetDescription>
              </SheetHeader>
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                timeZone={IST_TIME_ZONE}
                disabled={{ after: new Date() }}
              />
              <SheetFooter>
                <Button
                  type="button"
                  onClick={() => {
                    apply({
                      ...filters,
                      from: range?.from ? istDay(range.from) : undefined,
                      to: range?.to ? istDay(range.to) : undefined,
                    });
                  }}
                >
                  {t('apply')}
                </Button>
              </SheetFooter>
            </>
          ) : null}
          {open === 'actor' ? (
            <>
              <SheetHeader>
                <SheetTitle>{t('actor')}</SheetTitle>
                <SheetDescription className="sr-only">{t('actor')}</SheetDescription>
              </SheetHeader>
              <Select value={actor} onValueChange={setActor}>
                <SelectTrigger aria-label={t('actor')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('actorAll')}</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SheetFooter>
                <Button
                  type="button"
                  onClick={() => {
                    apply({ ...filters, actor: actor === ALL ? undefined : actor });
                  }}
                >
                  {t('apply')}
                </Button>
              </SheetFooter>
            </>
          ) : null}
          {open === 'action' ? (
            <>
              <SheetHeader>
                <SheetTitle>{t('action')}</SheetTitle>
                <SheetDescription className="sr-only">{t('action')}</SheetDescription>
              </SheetHeader>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger aria-label={t('action')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('actionAll')}</SelectItem>
                  {ACTION_GROUPS.map((group) => (
                    <SelectItem key={group} value={group}>
                      {groupLabel(group)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SheetFooter>
                <Button
                  type="button"
                  onClick={() => {
                    apply({ ...filters, action: action === ALL ? undefined : action });
                  }}
                >
                  {t('apply')}
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
