'use client';
// The Share a status link button and sheet (#88, ADR 0050): note editor, optional next date,
// expiry, language, an exact preview, and Create, which shows the URL once with Copy. Nothing is
// sent: the advocate shares the link themselves. Keys: Cmd/Ctrl+Enter creates, Esc closes. States:
// skeleton, empty (no client contact), error with retry, offline (creation disabled), denied.
import { Button } from '@causedeck/ui/button';
import {
  STATUS_LINK_LANGUAGES,
  STATUS_LINK_MAX_EXPIRY_DAYS,
} from '@causedeck/validators/status-link';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState, useSyncExternalStore, useTransition } from 'react';

import type { Result } from '../../../../../../../lib/safe-action.ts';
import type { CreatedLinkView, StatusLinkListItem } from './actions.ts';
import { StatusLinkList, type LinkListState } from './link-list.tsx';
import { StatusLinkPreview } from './preview.tsx';

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export interface StatusLinkContact {
  id: string;
  name: string;
}

export interface StatusLinkSheetActions {
  create: (raw: unknown) => Promise<Result<CreatedLinkView>>;
  revoke: (raw: unknown) => Promise<Result<{ id: string }>>;
  list: (raw: unknown) => Promise<Result<StatusLinkListItem[]>>;
}

export interface StatusLinkSheetProps {
  workspaceId: string;
  matterId: string;
  contacts: StatusLinkContact[];
  /** Shown on the preview's "prepared by" line. */
  advocateName: string | null;
  /** Advocates and owners only; others see the denied explanation. */
  canCreate: boolean;
  actions: StatusLinkSheetActions;
}

const DAY_MS = 86_400_000;

export function StatusLinkSheet({
  workspaceId,
  matterId,
  contacts,
  advocateName,
  canCreate,
  actions,
}: StatusLinkSheetProps) {
  const t = useTranslations('statusLink');
  const dialog = useRef<HTMLDialogElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [pending, start] = useTransition();
  const [list, setList] = useState<LinkListState>({ state: 'loading' });
  const [contactId, setContactId] = useState('');
  const [headline, setHeadline] = useState('');
  const [note, setNote] = useState('');
  const [withDate, setWithDate] = useState(false);
  const [nextDate, setNextDate] = useState('');
  const [language, setLanguage] = useState<'en' | 'ta' | 'kn'>('en');
  const [expiryDays, setExpiryDays] = useState(7);
  const [error, setError] = useState(false);
  const [created, setCreated] = useState<CreatedLinkView | null>(null);
  const [copied, setCopied] = useState(false);
  const [openedAt] = useState(() => Date.now());

  const load = useCallback(() => {
    setList({ state: 'loading' });
    void actions.list({ workspaceId, matterId }).then((r) => {
      setList(r.ok ? { state: 'ready', items: r.data } : { state: 'error' });
    });
  }, [actions, workspaceId, matterId]);

  const show = () => {
    dialog.current?.showModal();
    load();
  };

  const valid =
    contactId !== '' &&
    headline.trim() !== '' &&
    note.trim() !== '' &&
    (!withDate || nextDate !== '');
  const canSubmit = canCreate && online && valid && !pending;

  const submit = () => {
    if (!canSubmit) return;
    setError(false);
    start(async () => {
      const result = await actions.create({
        workspaceId,
        matterId,
        clientContactId: contactId,
        headline,
        note,
        ...(withDate ? { nextDate } : {}),
        language,
        expiryDays,
      });
      if (result.ok) {
        setCreated(result.data);
        load();
      } else {
        setError(true);
      }
    });
  };

  const copy = async () => {
    if (created === null) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
  };

  const revoke = (linkId: string) => {
    start(async () => {
      await actions.revoke({ workspaceId, linkId });
      load();
    });
  };

  const reset = () => {
    setCreated(null);
    setCopied(false);
    setHeadline('');
    setNote('');
    setWithDate(false);
    setNextDate('');
    dialog.current?.close();
  };

  const expiresAt = new Date(openedAt + expiryDays * DAY_MS).toISOString();

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={show}>
        {t('sheet.open')}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="status-link-title"
        className="bg-background text-foreground w-[min(40rem,100vw)] rounded-md p-4 backdrop:bg-black/40"
        onClose={() => {
          setCreated(null);
          setCopied(false);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="status-link-title" className="text-lg font-semibold">
              {t('sheet.title')}
            </h2>
            <p className="text-muted-foreground text-sm">{t('sheet.description')}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            {t('sheet.close')}
          </Button>
        </div>

        {!canCreate ? (
          <p role="status" className="mt-3">
            {t('sheet.denied')}
          </p>
        ) : created !== null ? (
          <div className="mt-3 space-y-2">
            <h3 className="font-medium">{t('created.title')}</h3>
            <p className="text-sm">{t('created.once')}</p>
            <p className="text-sm">{t('created.shareYourself')}</p>
            <input
              readOnly
              aria-label={t('created.url')}
              value={created.url}
              className="w-full rounded border p-2"
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <Button type="button" onClick={() => void copy()}>
              {t('created.copy')}
            </Button>
            <p ref={live} role="status" aria-live="polite" className="text-sm">
              {copied ? t('created.copied') : ''}
            </p>
          </div>
        ) : contacts.length === 0 ? (
          <p role="status" className="mt-3">
            {t('sheet.empty')}
          </p>
        ) : (
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="grid gap-1">
              {t('sheet.contact')}
              <select
                value={contactId}
                onChange={(event) => {
                  setContactId(event.target.value);
                }}
                className="rounded border p-2"
              >
                <option value="">{t('sheet.contactPlaceholder')}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              {t('sheet.headline')}
              <input
                value={headline}
                maxLength={140}
                onChange={(event) => {
                  setHeadline(event.target.value);
                }}
                className="rounded border p-2"
              />
            </label>
            <label className="grid gap-1">
              {t('sheet.note')}
              <textarea
                value={note}
                maxLength={1000}
                rows={4}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                className="rounded border p-2"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={withDate}
                onChange={(event) => {
                  setWithDate(event.target.checked);
                }}
              />
              {t('sheet.includeNextDate')}
            </label>
            {withDate ? (
              <label className="grid gap-1">
                {t('sheet.nextDate')}
                <input
                  type="date"
                  value={nextDate}
                  onChange={(event) => {
                    setNextDate(event.target.value);
                  }}
                  className="rounded border p-2"
                />
              </label>
            ) : null}
            <label className="grid gap-1">
              {t('sheet.expiry')}
              <select
                value={expiryDays}
                onChange={(event) => {
                  setExpiryDays(Number(event.target.value));
                }}
                className="rounded border p-2"
              >
                {[1, 3, 7, 14, STATUS_LINK_MAX_EXPIRY_DAYS].map((d) => (
                  <option key={d} value={d}>
                    {t('sheet.expiryDays', { days: d })}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              {t('sheet.language')}
              <select
                value={language}
                onChange={(event) => {
                  setLanguage(event.target.value as 'en' | 'ta' | 'kn');
                }}
                className="rounded border p-2"
              >
                {STATUS_LINK_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`languages.${l}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-muted-foreground text-sm">{t('sheet.previewHint')}</p>
            <StatusLinkPreview
              headline={headline}
              note={note}
              nextDate={withDate && nextDate !== '' ? nextDate : null}
              language={language}
              advocateName={advocateName}
              expiresAt={expiresAt}
            />
            {!online ? <p role="status">{t('sheet.offline')}</p> : null}
            {error ? (
              <p role="alert">
                {t('sheet.error')}{' '}
                <Button type="button" variant="ghost" size="sm" onClick={submit}>
                  {t('sheet.retry')}
                </Button>
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">{t('sheet.shortcut')}</p>
              <Button type="submit" disabled={!canSubmit}>
                {pending ? t('sheet.creating') : t('sheet.create')}
              </Button>
            </div>
          </form>
        )}
        <div className="mt-4">
          <StatusLinkList
            list={list}
            canRevoke={canCreate && online}
            onRevoke={revoke}
            onRetry={load}
          />
        </div>
      </dialog>
    </>
  );
}
