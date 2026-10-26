'use client';
// The manual "court is at item N" control of a hall header (#59). Setting persists through
// `setCurrentItemAction`, clearing through `clearCurrentItemAction`; the page then refreshes, so the
// marker rule and dimming come from the server render and are visible to every chamber member.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { clearCurrentItemAction, setCurrentItemAction } from './actions.ts';

export interface CourtIsAtMarkerFormProps {
  workspaceId: string;
  hallId: string;
  listDate: string;
  /** The item the marker is at now; null when none. */
  current: number | null;
}

export function CourtIsAtMarkerForm({
  workspaceId,
  hallId,
  listDate,
  current,
}: CourtIsAtMarkerFormProps) {
  const t = useTranslations('courtDay.board.marker');
  const router = useRouter();
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (clear: boolean) => {
    const item = Number(value);
    if (!clear && !(Number.isInteger(item) && item > 0)) {
      setError(t('invalid'));
      return;
    }
    start(async () => {
      const result = clear
        ? await clearCurrentItemAction({ workspaceId, hallId, listDate })
        : await setCurrentItemAction({ workspaceId, hallId, listDate, currentItem: item });
      if (result.ok) {
        setError(null);
        if (clear) setValue('');
        router.refresh();
      } else setError(t('failed'));
    });
  };

  return (
    <form
      data-slot="court-is-at"
      className="flex flex-wrap items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        run(false);
      }}
    >
      <label className="text-ink-muted text-xs" htmlFor={`court-is-at-${hallId}`}>
        {t('label')}
      </label>
      <input
        id={`court-is-at-${hallId}`}
        data-court-marker-input
        inputMode="numeric"
        className="border-border bg-surface h-11 w-16 rounded-md border px-2 text-center text-sm"
        value={value}
        aria-invalid={error !== null}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <Button type="submit" size="sm" className="min-h-11" disabled={pending}>
        {t('set')}
      </Button>
      {current === null ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11"
          disabled={pending}
          onClick={() => {
            run(true);
          }}
        >
          {t('clear')}
        </Button>
      )}
      {error === null ? null : (
        <span role="alert" className="text-danger basis-full text-xs">
          {error}
        </span>
      )}
    </form>
  );
}
