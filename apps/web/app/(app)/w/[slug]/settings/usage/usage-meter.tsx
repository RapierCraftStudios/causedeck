// One usage meter (#223): label, a thin progress bar (4 px track in `--line`, fill `--accent`,
// `--warning` from 80% and `--danger` at 100%, filling over `--dur-slow`, instant under reduced
// motion), the value in tabular numerals (`₹112.00 of ₹175.00`) with the percent used, and the plain
// reset line in `--ink-subtle` (`AI processing budget resets on 1 Apr`). The bar is a
// `role=progressbar` with aria values and a text alternative; a warning or reached level always
// shows an icon and text next to the colour. Unlimited resources show the value and `No limit on
// your plan` without a bar.
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
import { Progress, type ProgressTone } from '@causedeck/ui/progress';
import { OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { MeterView, UsageLevel } from './usage-view.ts';

const LEVEL_STYLE: Record<UsageLevel, { tone: ProgressTone; icon: LucideIcon | null }> = {
  ok: { tone: 'accent', icon: null },
  warning: { tone: 'warning', icon: TriangleAlert },
  exceeded: { tone: 'danger', icon: OctagonAlert },
};

const LEVEL_TEXT_CLASS: Record<UsageLevel, string> = {
  ok: '',
  warning: 'text-warning',
  exceeded: 'text-danger',
};

function LevelNote({ meter }: { meter: MeterView }) {
  const t = useTranslations('usage');
  const Icon = LEVEL_STYLE[meter.level].icon;
  if (meter.level === 'ok' || Icon === null || meter.percent === null) return null;
  const ai = meter.id === 'ai';
  const body =
    meter.level === 'warning'
      ? t(ai ? 'aiWarning' : 'limitWarning', { percent: meter.percent })
      : ai && meter.resetDate !== null
        ? t('aiExceeded', { date: meter.resetDate })
        : t('limitExceeded');
  return (
    <div data-slot="usage-meter-level" data-level={meter.level} className="flex gap-2 text-sm">
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${LEVEL_TEXT_CLASS[meter.level]}`} />
      <p>
        <span className="font-medium">{t(`level.${meter.level}`)}. </span>
        {body}
      </p>
    </div>
  );
}

export function UsageMeter({ meter }: { meter: MeterView }) {
  const t = useTranslations('usage');
  const label = t(`meters.${meter.id}`);
  const limited = meter.limit !== null && meter.percent !== null;
  return (
    <Card data-slot="usage-meter" data-meter={meter.id} data-level={meter.level}>
      <CardHeader>
        <CardTitle asChild>
          <h2 className="text-base">{label}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {limited ? (
          <>
            <Progress
              aria-label={label}
              aria-valuetext={t('valueText', {
                percent: meter.percent ?? 0,
                used: meter.used,
                limit: meter.limit ?? '',
              })}
              value={Math.min(meter.percent ?? 0, 100)}
              max={100}
              tone={LEVEL_STYLE[meter.level].tone}
              className="bg-line h-1 [&>[data-slot=progress-indicator]]:duration-(--dur-slow)"
            />
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm tabular-nums">
              <span data-slot="usage-meter-value">
                {t('value', { used: meter.used, limit: meter.limit ?? '' })}
              </span>
              <span data-slot="usage-meter-percent" className="text-ink-muted">
                {t('percentUsed', { percent: meter.percent ?? 0 })}
              </span>
            </p>
          </>
        ) : (
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm tabular-nums">
            <span data-slot="usage-meter-value">{meter.used}</span>
            <span className="text-ink-muted">{t('unlimited')}</span>
          </p>
        )}
        <LevelNote meter={meter} />
        {meter.resetDate === null ? null : (
          <p data-slot="usage-meter-reset" className="text-ink-subtle text-xs">
            {meter.id === 'ai'
              ? t('aiResets', { date: meter.resetDate })
              : t('resets', { date: meter.resetDate })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
