'use client';
// The "Subscribe in your calendar" panel (#66 R7). The feed token is stored only as a hash, so the
// URL can be shown once, straight after the #53 server action issues it: `create` for a first link
// (behind the same "outside India" acknowledgement as settings) and `rotate` to regenerate (which
// revokes the old link). Nothing here stores or logs the URL; it lives in component state until the
// page is left.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import { Input } from '@causedeck/ui/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';

export interface SubscribePanelActions {
  create(input: unknown): Promise<Result<{ url: string }>>;
  rotate(input: unknown): Promise<Result<{ url: string }>>;
}

export interface SubscribePanelProps {
  workspaceId: string;
  active: boolean;
  disclosureVersion: string;
  manageHref: string;
  actions: SubscribePanelActions;
}

export function SubscribePanel({
  workspaceId,
  active: initial,
  disclosureVersion,
  manageHref,
  actions,
}: SubscribePanelProps) {
  const t = useTranslations('calendarView.subscribe');
  const [active, setActive] = useState(initial);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setPending(true);
    setError(null);
    let result: Result<{ url: string }>;
    try {
      result = await (active
        ? actions.rotate({ workspaceId })
        : actions.create({ workspaceId, scope: 'mine', includeParties: false, disclosureVersion }));
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      setError(t(result.error.code === 'FORBIDDEN' ? 'forbidden' : 'error'));
      return;
    }
    setActive(true);
    setUrl(result.data.url);
    setCopied(false);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError(t('copyFailed'));
    }
  }

  return (
    <section aria-label={t('title')} data-section="subscribe" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{t('title')}</h2>
      <p className="text-ink-muted text-sm" data-slot="subscribe-private">
        {t('explanation')}
      </p>
      <p className="text-sm" data-slot="subscribe-status">
        {active ? t('active') : t('inactive')}
      </p>
      {active ? null : (
        <>
          <Alert tone="warning">{t('disclosure')}</Alert>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={ack}
              onCheckedChange={(v) => {
                setAck(v === true);
              }}
            />
            {t('ack')}
          </label>
        </>
      )}
      {url === null ? null : (
        <div className="flex flex-col gap-2" data-slot="subscribe-url">
          <label className="text-sm" htmlFor="subscribe-url-field">
            {t('urlLabel')}
          </label>
          <div className="flex gap-2">
            <Input
              id="subscribe-url-field"
              readOnly
              value={url}
              className="font-mono"
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <Button type="button" onClick={() => void copy(url)}>
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
          <Alert tone="warning">{t('shownOnce')}</Alert>
        </div>
      )}
      {active && url === null ? <p className="text-ink-muted text-xs">{t('revokesOld')}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          data-slot="subscribe-issue"
          disabled={pending || (!active && !ack)}
          aria-busy={pending || undefined}
          onClick={() => void issue()}
        >
          {pending ? t('working') : active ? t('regenerate') : t('generate')}
        </Button>
        <a href={manageHref} className="text-sm underline">
          {t('manage')}
        </a>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
