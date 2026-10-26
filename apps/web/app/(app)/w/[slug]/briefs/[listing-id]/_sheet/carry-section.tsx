'use client';
// The carry list (#61, R4): tick, add and remove inline. Each change is saved through
// `setCarryItemAction` (persisted in `brief_state`, so it survives a reload and a brief refresh);
// the list updates at once and rolls back when the save fails.
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import { Input } from '@causedeck/ui/input';
import type { CarryItem } from '@causedeck/validators';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { setCarryItemAction } from '../actions.ts';

import { MemoryCitation } from './memory-citation.tsx';

export interface CarrySectionProps {
  workspaceId: string;
  listingId: string;
  items: readonly CarryItem[];
  reviewed: boolean;
  canWrite: boolean;
  offline: boolean;
}

export function CarrySection({
  workspaceId,
  listingId,
  items,
  reviewed,
  canWrite,
  offline,
}: CarrySectionProps) {
  const t = useTranslations('brief.carry');
  const tp = useTranslations('brief.prepared');
  const [list, setList] = useState<readonly CarryItem[]>(items);
  const [queued, setQueued] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const inputId = useId();

  // A refresh brings the stored list: it wins over the local copy.
  const [seenItems, setSeenItems] = useState(items);
  if (seenItems !== items) {
    setSeenItems(items);
    setList(items);
  }

  function save(
    input: Record<string, unknown>,
    rollback: readonly CarryItem[],
    key: string | null,
  ) {
    setError(false);
    if (offline) {
      if (key) setQueued((q) => new Set(q).add(key));
      return;
    }
    start(async () => {
      const result = await setCarryItemAction({ workspaceId, listingId, ...input });
      if (!result.ok) {
        setList(rollback);
        setError(true);
      }
    });
  }

  const tick = (item: CarryItem, ticked: boolean) => {
    const before = list;
    setList(list.map((i) => (i.key === item.key ? { ...i, ticked } : i)));
    save({ action: 'tick', key: item.key, ticked }, before, item.key);
  };
  const remove = (item: CarryItem) => {
    const before = list;
    setList(list.filter((i) => i.key !== item.key));
    save({ action: 'remove', key: item.key }, before, item.key);
  };
  const add = () => {
    const label = draft.trim();
    if (label === '') return;
    const before = list;
    setList([
      ...list,
      {
        key: `manual:pending-${String(list.length)}`,
        kind: 'manual',
        label,
        document_id: null,
        ticked: false,
      },
    ]);
    setDraft('');
    save({ action: 'add', label }, before, null);
  };

  return (
    <div data-carry-list tabIndex={-1} className="grid gap-2">
      {list.length === 0 ? <p className="text-muted-foreground">{t('empty')}</p> : null}
      <ul className="grid gap-1">
        {list.map((item) => (
          <li key={item.key} data-carry-item className="flex break-inside-avoid items-center gap-2">
            <Checkbox
              checked={item.ticked}
              disabled={!canWrite}
              aria-label={t('tick', { label: item.label })}
              onCheckedChange={(value) => {
                tick(item, value === true);
              }}
            />
            <span
              className={item.ticked ? 'text-muted-foreground line-through print:text-black' : ''}
            >
              {item.label}
            </span>
            <span className="text-muted-foreground font-sans text-xs print:hidden">
              {t(`kind.${item.kind}`)}
            </span>
            {item.kind === 'rule' ? <MemoryCitation reason="carryRule" /> : null}
            {queued.has(item.key) ? (
              <span className="font-sans text-xs print:hidden">{t('willSync')}</span>
            ) : null}
            {canWrite ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto print:hidden"
                aria-label={t('remove', { label: item.label })}
                onClick={() => {
                  remove(item);
                }}
              >
                ×
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <form
          className="flex flex-wrap items-center gap-2 print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {t('addLabel')}
          </label>
          <Input
            id={inputId}
            value={draft}
            maxLength={500}
            placeholder={t('addPlaceholder')}
            className="max-w-xs"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={pending || draft.trim() === ''}
          >
            {t('add')}
          </Button>
          {reviewed ? null : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                save({ action: 'review' }, list, null);
              }}
            >
              {t('reviewed')}
            </Button>
          )}
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive font-sans text-sm">
          {tp('error')}
        </p>
      ) : null}
    </div>
  );
}
