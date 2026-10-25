'use client';

// Read-only seat display (#256): seats in use against purchased seats, with clerk seats apart (they
// are billed separately). With `billing.manage` it hosts the seat stepper (#257).
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
import { Progress } from '@causedeck/ui/progress';
import { useTranslations } from 'next-intl';

import type { ManageView, SeatsView } from './billing-view.ts';
import { SeatManager } from './seat-manager.tsx';

function SeatRow({
  label,
  text,
  used,
  total,
  slot,
}: {
  label: string;
  text: string;
  used: number;
  total: number;
  slot: string;
}) {
  return (
    <div data-slot={slot} className="flex flex-col gap-1.5">
      <p className="text-sm tabular-nums">{text}</p>
      <Progress
        aria-label={label}
        value={Math.min(used, total)}
        max={Math.max(total, 1)}
        tone={used > total ? 'danger' : 'accent'}
      />
    </div>
  );
}

export interface SeatSummaryProps {
  seats: SeatsView;
  /** Present only with `billing.manage`: the seat stepper. */
  manage?: { workspaceId: string; slug: string; view: ManageView } | undefined;
  className?: string;
}

export function SeatSummary({ seats, manage, className }: SeatSummaryProps) {
  const t = useTranslations('billing.seats');
  return (
    <Card data-slot="billing-seats" className={className}>
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SeatRow
          slot="billing-seats-members"
          label={t('membersLabel')}
          text={t('members', { used: seats.used, total: seats.total })}
          used={seats.used}
          total={seats.total}
        />
        {seats.clerks === null ? null : (
          <>
            <SeatRow
              slot="billing-seats-clerks"
              label={t('clerksLabel')}
              text={t('clerks', { used: seats.clerks.used, total: seats.clerks.total })}
              used={seats.clerks.used}
              total={seats.clerks.total}
            />
            <p className="text-ink-muted text-xs">{t('hint')}</p>
          </>
        )}
        {manage ? (
          <SeatManager workspaceId={manage.workspaceId} slug={manage.slug} manage={manage.view} />
        ) : null}
      </CardContent>
    </Card>
  );
}
