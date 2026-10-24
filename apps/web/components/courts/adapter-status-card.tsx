'use client';

// The Adapter tab's status card (#400, #42): the adapter id, its active version, the level with a
// keyboard-reachable popover explaining the levels in plain language (only A0 and A1 exist; higher
// levels are named as not available yet), when the version was last verified against real lists,
// its health across workspaces (counts only, from `adapter_health_summary`) and this workspace's
// last parse. Health is a dot paired with text.
import type { AdapterStatus } from '@causedeck/core/court';
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@causedeck/ui/popover';
import { CircleHelp } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { AdapterLevelBadge, SHOWN_LEVELS } from './adapter-level-badge.tsx';
import { DOT_TONE } from './forum-card.tsx';

export interface AdapterStatusCardProps {
  status: AdapterStatus;
}

function Row({ label, children, name }: { label: string; children: ReactNode; name: string }) {
  return (
    <div data-adapter-field={name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-ink-muted w-44 shrink-0 text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function AdapterStatusCard({ status }: AdapterStatusCardProps) {
  const t = useTranslations('courts.detail.adapter');
  const format = useFormatter();
  const health = status.health ?? 'none';
  const date = (value: Date) => format.dateTime(new Date(value), { dateStyle: 'medium' });
  const dateTime = (value: Date) =>
    format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Card data-adapter-status={status.adapterId}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-3">
          <Row name="id" label={t('id')}>
            <code className="font-mono text-xs break-all">{status.adapterId}</code>
          </Row>
          <Row name="version" label={t('version')}>
            {status.activeVersion ?? <span className="text-ink-muted">{t('noVersion')}</span>}
          </Row>
          <Row name="level" label={t('level')}>
            <span className="inline-flex flex-wrap items-center gap-2">
              {status.level === null ? null : <AdapterLevelBadge level={status.level} />}
              <Popover>
                <PopoverTrigger
                  type="button"
                  data-adapter-levels-trigger=""
                  className="text-accent focus-visible:outline-ring inline-flex items-center gap-1 rounded-sm text-sm underline-offset-2 outline-offset-2 hover:underline focus-visible:outline-2"
                >
                  <CircleHelp aria-hidden="true" className="size-3.5" />
                  {t('levelHelp')}
                </PopoverTrigger>
                <PopoverContent data-adapter-levels="" aria-label={t('levelsTitle')}>
                  <p className="mb-2 font-medium">{t('levelsTitle')}</p>
                  <ul className="flex flex-col gap-2">
                    {SHOWN_LEVELS.map((level) => (
                      <li key={level} data-adapter-level-help={level}>
                        {t(`level${level}`)}
                      </li>
                    ))}
                    <li className="text-ink-muted">{t('levelHigher')}</li>
                  </ul>
                </PopoverContent>
              </Popover>
            </span>
          </Row>
          <Row name="verified" label={t('lastVerified')}>
            {status.lastVerifiedAt === null ? (
              <span className="text-ink-muted">{t('notVerified')}</span>
            ) : (
              <time dateTime={new Date(status.lastVerifiedAt).toISOString()}>
                {date(status.lastVerifiedAt)}
              </time>
            )}
          </Row>
          <Row name="health" label={t('health')}>
            <span data-adapter-health={health} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                data-slot="status-dot"
                className={`size-2 rounded-full bg-current ${DOT_TONE[health]}`}
              />
              {t(`healthStatus.${health}`)}
            </span>
          </Row>
          <Row name="last-parse" label={t('lastParse')}>
            {status.lastParse === null ? (
              <span className="text-ink-muted">{t('lastParseNone')}</span>
            ) : (
              <span className="flex flex-col gap-0.5">
                <time dateTime={new Date(status.lastParse.at).toISOString()}>
                  {dateTime(status.lastParse.at)}
                </time>
                <span>
                  {t('rows', {
                    parsed: status.lastParse.rowsParsed,
                    anchored: status.lastParse.rowsAnchored,
                  })}
                </span>
                {status.lastParse.hallsUnreadable.length === 0 ? null : (
                  <span data-adapter-unreadable="">
                    {t('unreadableHalls', { halls: status.lastParse.hallsUnreadable.join(', ') })}
                  </span>
                )}
              </span>
            )}
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}
