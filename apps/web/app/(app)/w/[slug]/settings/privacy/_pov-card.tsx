'use client';
// Proof of value in privacy settings (#86): the opt-out toggle (stops prompts at once), the
// member's own answers with delete, and the owner's manual report download. Nothing is sent
// anywhere: the CSV is built here from the response and saved by the browser.
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  deleteOwnRatingAction,
  downloadPovReportAction,
  setPovPrefsAction,
} from '../../_pov/actions.ts';

export interface PovCardRating {
  id: string;
  rating: number | null;
  skipped: boolean;
}
export interface PovCardPulse {
  id: string;
  isoWeek: string;
  demand: number | null;
  worry: number | null;
  effort: number | null;
}

export function PovCard({
  workspaceId,
  enabled,
  ratings,
  pulses,
  isOwner,
}: {
  workspaceId: string;
  enabled: boolean;
  ratings: readonly PovCardRating[];
  pulses: readonly PovCardPulse[];
  isOwner: boolean;
}) {
  const t = useTranslations('pov.privacy');
  const [on, setOn] = useState(enabled);
  const [rows, setRows] = useState(ratings);
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);

  async function run(call: () => Promise<{ ok: boolean }>, done: () => void, message = '') {
    if (!navigator.onLine) {
      setFailed(true);
      setStatus(t('offline'));
      return;
    }
    try {
      const result = await call();
      setFailed(!result.ok);
      if (result.ok) done();
      setStatus(result.ok ? message : t('error'));
    } catch {
      setFailed(true);
      setStatus(t('error'));
    }
  }
  const toggle = (next: boolean) =>
    run(
      () => setPovPrefsAction({ workspaceId, promptsEnabled: next }),
      () => {
        setOn(next);
      },
      next ? t('toggleOn') : t('toggleOff'),
    );
  const remove = (ratingId: string) =>
    run(
      () => deleteOwnRatingAction({ workspaceId, ratingId }),
      () => {
        setRows((r) => r.filter((x) => x.id !== ratingId));
      },
      t('deleted'),
    );
  const download = () =>
    run(
      async () => {
        const result = await downloadPovReportAction({ workspaceId });
        if (result.ok) {
          const url = URL.createObjectURL(new Blob([result.data.csv], { type: 'text/csv' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = 'proof-of-value.csv';
          link.click();
          URL.revokeObjectURL(url);
        }
        return result;
      },
      () => undefined,
    );

  return (
    <section
      data-slot="pov-card"
      aria-labelledby="pov-card-title"
      className="border-line bg-surface flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2 id="pov-card-title" className="font-serif text-lg font-medium">
        {t('title')}
      </h2>
      <p className="text-sm">{t('intro')}</p>
      <label className="flex min-h-12 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-6"
          checked={on}
          onChange={(event) => void toggle(event.target.checked)}
        />
        {t('toggle')}
      </label>
      <h3 className="text-sm font-medium">{t('yours')}</h3>
      {rows.length === 0 && pulses.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2">
              <span>{row.skipped ? t('skipped') : t('rating', { rating: row.rating ?? 0 })}</span>
              <Button variant="outline" className="min-h-12" onClick={() => void remove(row.id)}>
                {t('delete')}
              </Button>
            </li>
          ))}
          {pulses.map((p) => (
            <li key={p.id}>
              {t('pulse', {
                week: p.isoWeek,
                demand: p.demand ?? '-',
                worry: p.worry ?? '-',
                effort: p.effort ?? '-',
              })}
            </li>
          ))}
        </ul>
      )}
      {isOwner ? (
        <div className="flex flex-col gap-1">
          <Button variant="outline" className="min-h-12 w-fit" onClick={() => void download()}>
            {t('download')}
          </Button>
          <p className="text-ink-muted text-sm">{t('downloadHint')}</p>
        </div>
      ) : null}
      <p role={failed ? 'alert' : 'status'} aria-live="polite" className="text-sm">
        {status}
      </p>
    </section>
  );
}
