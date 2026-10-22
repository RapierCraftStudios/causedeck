'use client';

// Seat stepper (#257): owners change seats and clerk seats with labelled +/- buttons (each change
// announced through an aria-live region), then confirm a summary from `quoteChange`: the new
// charge per period with GST at 18%, the prorated amount due now and when the change takes
// effect. Increases apply now; decreases at the end of the period. Seats cannot go below the
// plan's minimum or the seats already in use. Disabled offline.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';

import type { Result } from '../../../../../lib/safe-action.ts';

import { changeSeats, quoteChange, type BillingActionOutcome, type QuoteView } from './actions.ts';
import type { ManageView } from './billing-view.ts';

/** Seats are capped here in the UI; the server accepts up to 10,000. */
const MAX_SEATS = 500;

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export type BillingErrorKey =
  | 'invalidGstinFormat'
  | 'invalidGstinChecksum'
  | 'invalid'
  | 'notAllowed'
  | 'unsupported'
  | 'forbidden'
  | 'generic';

/** A billing action's failure as a `billing.errors.*` key; null on success. */
export function billingErrorKey(result: Result<BillingActionOutcome>): BillingErrorKey | null {
  if (!result.ok) return result.error.code === 'FORBIDDEN' ? 'forbidden' : 'generic';
  return result.data.error ?? null;
}

/** The confirm-step summary shared by the seat stepper and the change-plan dialog. */
export function QuoteSummary({ quote }: { quote: QuoteView }) {
  const t = useTranslations('billing.quote');
  const rows: [string, string, string][] = [
    ['base', t('base'), quote.formatted.base],
    ['gst', t('gst'), quote.formatted.gst],
    ['total', t('total'), quote.formatted.total],
    ['proration', t('proration'), quote.formatted.proration],
    ['prorationGst', t('prorationGst'), quote.formatted.prorationGst],
    ['prorationTotal', t('prorationTotal'), quote.formatted.prorationTotal],
  ];
  return (
    <div data-slot="billing-quote" className="flex flex-col gap-2">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map(([key, label, value]) => (
          <div key={key} data-quote={key} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-end tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p data-slot="billing-quote-effective" className="text-sm">
        {quote.effective === 'now'
          ? t('effectiveNow', { date: quote.formatted.effectiveDate })
          : t('effectivePeriodEnd', { date: quote.formatted.effectiveDate })}
      </p>
    </div>
  );
}

function Stepper({
  id,
  label,
  value,
  min,
  disabled,
  increaseLabel,
  decreaseLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  disabled: boolean;
  increaseLabel: string;
  decreaseLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div data-slot={`billing-stepper-${id}`} className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label={decreaseLabel}
          disabled={disabled || value <= min}
          onClick={() => {
            onChange(value - 1);
          }}
        >
          <Minus aria-hidden="true" />
        </Button>
        <span className="w-10 text-center tabular-nums" data-value={id}>
          {value}
        </span>
        <Button
          variant="secondary"
          size="sm"
          aria-label={increaseLabel}
          disabled={disabled || value >= MAX_SEATS}
          onClick={() => {
            onChange(value + 1);
          }}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export interface SeatManagerProps {
  workspaceId: string;
  slug: string;
  manage: ManageView;
}

export function SeatManager({ workspaceId, slug, manage }: SeatManagerProps) {
  const t = useTranslations('billing');
  const online = useOnline();
  const [seats, setSeats] = useState(manage.seats);
  const [clerkSeats, setClerkSeats] = useState(manage.clerkSeats);
  const [announcement, setAnnouncement] = useState('');
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<BillingErrorKey | null>(null);
  const [done, setDone] = useState(false);

  const minSeats = Math.max(manage.minSeats, manage.seatsUsed.nonClerk, 1);
  const minClerkSeats = manage.seatsUsed.clerk;
  const changed = seats !== manage.seats || clerkSeats !== manage.clerkSeats;
  const busy = pending || !online;

  function update(kind: 'seats' | 'clerkSeats', value: number) {
    setQuote(null);
    setError(null);
    setDone(false);
    if (kind === 'seats') {
      setSeats(value);
      setAnnouncement(t('seatManager.announceSeats', { count: value }));
    } else {
      setClerkSeats(value);
      setAnnouncement(t('seatManager.announceClerkSeats', { count: value }));
    }
  }

  async function review() {
    setError(null);
    setPending(true);
    try {
      const result = await quoteChange({ workspaceId, planId: manage.planId, seats, clerkSeats });
      const key = billingErrorKey(result);
      if (key === null && result.ok && !result.data.error) setQuote(result.data.quote);
      else setError(key ?? 'generic');
    } catch {
      setError('generic');
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    setError(null);
    setPending(true);
    try {
      const key = billingErrorKey(await changeSeats({ workspaceId, slug, seats, clerkSeats }));
      if (key === null) {
        setQuote(null);
        setDone(true);
      } else setError(key);
    } catch {
      setError('generic');
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-slot="billing-seat-manager" className="flex flex-col gap-3">
      <Stepper
        id="seats"
        label={t('seatManager.seats')}
        value={seats}
        min={minSeats}
        disabled={busy}
        increaseLabel={t('seatManager.increaseSeats')}
        decreaseLabel={t('seatManager.decreaseSeats')}
        onChange={(value) => {
          update('seats', value);
        }}
      />
      {manage.clerkSeatsAvailable ? (
        <Stepper
          id="clerkSeats"
          label={t('seatManager.clerkSeats')}
          value={clerkSeats}
          min={minClerkSeats}
          disabled={busy}
          increaseLabel={t('seatManager.increaseClerkSeats')}
          decreaseLabel={t('seatManager.decreaseClerkSeats')}
          onChange={(value) => {
            update('clerkSeats', value);
          }}
        />
      ) : null}
      <p className="text-ink-muted text-xs">
        {t('seatManager.minHint', { min: minSeats, used: manage.seatsUsed.nonClerk })}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {quote ? <QuoteSummary quote={quote} /> : null}
      {error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null}
      {done ? (
        <p role="status" className="text-sm">
          {t('seatManager.done')}
        </p>
      ) : null}
      <div className="flex gap-2">
        {quote ? (
          <>
            <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
              {t('seatManager.confirm')}
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setQuote(null);
              }}
            >
              {t('seatManager.back')}
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled={busy || !changed} onClick={() => void review()}>
            {t('seatManager.review')}
          </Button>
        )}
      </div>
      {online ? null : <p className="text-ink-muted text-xs">{t('errors.offline')}</p>}
    </div>
  );
}
