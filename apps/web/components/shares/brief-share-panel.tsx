'use client';
// The owner's brief sharing panel (#507) on a matter: create an expiring link (1 to 30 days), copy
// it (shown once, at creation: only its hash is stored), list the active links and revoke any of
// them. Only owners are given `canShare`; the actions check the policy and the role again.
import { Button } from '@causedeck/ui/button';
import { toast } from '@causedeck/ui/sonner';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import type { Result } from '../../lib/safe-action.ts';

export interface ShareLinkView {
  id: string;
  matterTitle: string;
  /** ISO timestamps. */
  createdAt: string;
  expiresAt: string;
  /** The viewer may revoke it (its creator or an owner). */
  canRevoke: boolean;
}

export interface CreatedShareResult {
  id: string;
  path: string;
  expiresAt: string;
}

export interface BriefSharePanelProps {
  workspaceId: string;
  /** The listing the brief is shared from, or `null` when the matter has none yet. */
  listingId: string | null;
  canShare: boolean;
  shares: readonly ShareLinkView[];
  actions: {
    create: (input: {
      workspaceId: string;
      listingId: string;
      expiresInDays: number;
    }) => Promise<Result<CreatedShareResult>>;
    revoke: (input: { workspaceId: string; shareId: string }) => Promise<Result<{ id: string }>>;
  };
}

export const EXPIRY_CHOICES = [1, 7, 14, 30] as const;

function errorKey(error: { code: string; message: string }): string {
  if (error.code === 'CONFLICT' && error.message === 'RATE_LIMITED') return 'rateLimited';
  if (error.code === 'FORBIDDEN') return 'forbidden';
  if (error.code === 'NOT_FOUND') return 'notFound';
  return 'generic';
}

export function BriefSharePanel({
  workspaceId,
  listingId,
  canShare,
  shares,
  actions,
}: BriefSharePanelProps) {
  const t = useTranslations('share.manage');
  const format = useFormatter();
  const router = useRouter();
  const expiryId = useId();
  const linkId = useId();
  const [days, setDays] = useState<number>(7);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const create = () => {
    if (listingId === null) return;
    setError(null);
    startTransition(async () => {
      const result = await actions.create({ workspaceId, listingId, expiresInDays: days });
      if (!result.ok) {
        setCreated(null);
        setError(t(`errors.${errorKey(result.error)}`));
        return;
      }
      setCreated({
        url: new URL(result.data.path, window.location.origin).toString(),
        expiresAt: result.data.expiresAt,
      });
      router.refresh();
    });
  };

  const copy = async () => {
    if (created === null) return;
    try {
      await navigator.clipboard.writeText(created.url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  const revoke = (shareId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await actions.revoke({ workspaceId, shareId });
      if (!result.ok) {
        setError(t(`errors.${errorKey(result.error)}`));
        return;
      }
      toast.success(t('revoked'));
      router.refresh();
    });
  };

  const disabled = pending;

  return (
    <section
      data-slot="brief-share"
      aria-labelledby={`${linkId}-title`}
      className="border-line flex flex-col gap-4 rounded-lg border p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id={`${linkId}-title`} className="text-base font-medium">
          {t('title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>

      {canShare ? (
        listingId === null ? (
          <p data-share-no-listing="" className="text-ink-muted text-sm">
            {t('noListing')}
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={expiryId} className="text-sm font-medium">
                {t('expiry')}
              </label>
              <select
                id={expiryId}
                value={days}
                disabled={disabled}
                onChange={(event) => setDays(Number(event.target.value))}
                className="border-line bg-surface h-9 rounded-md border px-2 text-sm"
              >
                {EXPIRY_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {t('days', { count: choice })}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" data-share-create="" disabled={disabled} onClick={create}>
              {pending ? t('creating') : t('create')}
            </Button>
          </div>
        )
      ) : null}

      {error === null ? null : (
        <p role="alert" data-share-error="" className="text-danger text-sm">
          {error}
        </p>
      )}

      {created === null ? null : (
        <div data-share-created="" role="status" className="flex flex-col gap-2">
          <p className="text-sm">{t('createdOnce', { date: when(created.expiresAt) })}</p>
          <div className="flex gap-2">
            <input
              readOnly
              aria-label={t('linkLabel')}
              value={created.url}
              onFocus={(event) => event.currentTarget.select()}
              className="border-line bg-surface h-9 min-w-0 flex-1 rounded-md border px-2 font-mono text-xs"
            />
            <Button type="button" variant="outline" data-share-copy="" onClick={copy}>
              {t('copy')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('activeTitle')}</h3>
        {shares.length === 0 ? (
          <p data-share-empty="" className="text-ink-muted text-sm">
            {t('empty')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {shares.map((share) => (
              <li
                key={share.id}
                data-share={share.id}
                className="border-line flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{share.matterTitle}</span>
                  <span className="text-ink-muted text-xs">
                    {t('createdOn', { date: when(share.createdAt) })}
                    {' · '}
                    {t('expiresOn', { date: when(share.expiresAt) })}
                  </span>
                </div>
                {share.canRevoke ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-share-revoke={share.id}
                    disabled={disabled}
                    aria-label={t('revokeLabel', { title: share.matterTitle })}
                    onClick={() => revoke(share.id)}
                  >
                    {t('revoke')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
