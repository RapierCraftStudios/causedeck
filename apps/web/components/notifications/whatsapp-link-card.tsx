'use client';
// The WhatsApp link card (#681, part 4 of #502, D-029) on the notification settings page. Unlinked:
// the number and an explicit opt-in, then the six-digit code. Linked: the masked number, the
// categories sent to WhatsApp and `Unlink`. Messages go only to the number verified here; the full
// number is never shown again. Every change goes through a server action passed in by the page.
import { WHATSAPP_CATEGORIES, type WhatsAppCategory } from '@causedeck/notifications/whatsapp';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import type { WhatsAppLinkState } from '../../app/(app)/w/[slug]/settings/notifications/whatsapp-actions.ts';
import type { Result } from '../../lib/safe-action.ts';

export interface WhatsAppLinkActions {
  requestOtp: (input: {
    workspaceId: string;
    e164: string;
    consent: boolean;
  }) => Promise<Result<{ expiresAt: string }>>;
  verifyOtp: (input: { workspaceId: string; code: string }) => Promise<Result<WhatsAppLinkState>>;
  setCategories: (input: {
    workspaceId: string;
    categories: string[];
  }) => Promise<Result<WhatsAppLinkState>>;
  unlink: (input: { workspaceId: string }) => Promise<Result<{ unlinked: true }>>;
}

export interface WhatsAppLinkCardProps {
  workspaceId: string;
  /** The member's link, or null when not linked. */
  link: WhatsAppLinkState | null;
  actions: WhatsAppLinkActions;
}

const CATEGORY_MESSAGE = {
  'court.board': 'courtBoard',
  'status.order': 'statusOrder',
  'digest.end_of_day': 'digestEndOfDay',
  'onboarding.nudge': 'onboardingNudge',
} as const satisfies Record<WhatsAppCategory, string>;

type Notice =
  | { kind: 'none' }
  | { kind: 'saved' }
  | { kind: 'unlinked' }
  | { kind: 'sent' }
  | { kind: 'error'; message: 'consent' | 'invalid' | 'conflict' | 'generic' };

const INPUT_CLASS =
  'border-line-control bg-surface-raised text-ink w-full max-w-xs rounded-sm border px-3 py-2 text-sm';

function errorKey(
  result: Extract<Result<unknown>, { ok: false }>,
): 'invalid' | 'conflict' | 'generic' {
  if (result.error.code === 'VALIDATION') return 'invalid';
  if (result.error.code === 'CONFLICT') return 'conflict';
  return 'generic';
}

export function WhatsAppLinkCard({ workspaceId, link: initial, actions }: WhatsAppLinkCardProps) {
  const t = useTranslations('whatsappLink');
  const ids = useId();
  const [link, setLink] = useState<WhatsAppLinkState | null>(initial);
  const [number, setNumber] = useState('');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>({ kind: 'none' });

  /** Run one action; a thrown call reads as a generic error. */
  async function run<O>(send: () => Promise<Result<O>>, done: (data: O) => void) {
    setBusy(true);
    setNotice({ kind: 'none' });
    try {
      const result = await send();
      if (result.ok) done(result.data);
      else setNotice({ kind: 'error', message: errorKey(result) });
    } catch {
      setNotice({ kind: 'error', message: 'generic' });
    } finally {
      setBusy(false);
    }
  }

  function requestCode() {
    if (!consent) {
      setNotice({ kind: 'error', message: 'consent' });
      return;
    }
    void run(
      () => actions.requestOtp({ workspaceId, e164: number.trim(), consent }),
      () => {
        setCodeSent(true);
        setNotice({ kind: 'sent' });
      },
    );
  }

  function verify() {
    void run(
      () => actions.verifyOtp({ workspaceId, code: code.trim() }),
      (next) => {
        setLink(next);
        setCode('');
        setNumber('');
        setCodeSent(false);
        setNotice({ kind: 'saved' });
      },
    );
  }

  function toggle(category: WhatsAppCategory, on: boolean) {
    if (link === null) return;
    const chosen = new Set(link.categories);
    if (on) chosen.add(category);
    else chosen.delete(category);
    void run(
      () => actions.setCategories({ workspaceId, categories: [...chosen] }),
      (next) => {
        setLink(next);
        setNotice({ kind: 'saved' });
      },
    );
  }

  function unlink() {
    void run(
      () => actions.unlink({ workspaceId }),
      () => {
        setLink(null);
        setCodeSent(false);
        setNotice({ kind: 'unlinked' });
      },
    );
  }

  return (
    <section
      data-slot="whatsapp-link-card"
      aria-labelledby={`${ids}-title`}
      className="border-line bg-surface-raised flex flex-col gap-4 rounded-md border p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id={`${ids}-title`} className="text-base font-medium">
          {t('title')}
        </h2>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>

      {link === null ? (
        <div className="flex flex-col gap-3">
          <label htmlFor={`${ids}-number`} className="text-sm font-medium">
            {t('numberLabel')}
          </label>
          <input
            id={`${ids}-number`}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={number}
            onChange={(event) => {
              setNumber(event.target.value);
            }}
            className={INPUT_CLASS}
          />
          <p className="text-ink-muted text-xs">{t('numberHint')}</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => {
                setConsent(event.target.checked);
              }}
              className="mt-1"
            />
            <span>{t('consent')}</span>
          </label>
          <div>
            <Button type="button" onClick={requestCode} disabled={busy || number.trim() === ''}>
              {t('sendCode')}
            </Button>
          </div>
          {codeSent ? (
            <div className="flex flex-col gap-3">
              <label htmlFor={`${ids}-code`} className="text-sm font-medium">
                {t('codeLabel')}
              </label>
              <input
                id={`${ids}-code`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
                className={INPUT_CLASS}
              />
              <div>
                <Button type="button" onClick={verify} disabled={busy || code.trim().length !== 6}>
                  {t('verify')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t('linked', { number: link.maskedNumber })}</p>
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className="text-sm font-medium">{t('categoriesTitle')}</legend>
            {WHATSAPP_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={link.categories.includes(category)}
                  onChange={(event) => {
                    toggle(category, event.target.checked);
                  }}
                />
                <span>{t(`categories.${CATEGORY_MESSAGE[category]}`)}</span>
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="button" variant="secondary" onClick={unlink} disabled={busy}>
              {t('unlink')}
            </Button>
          </div>
        </div>
      )}

      {notice.kind === 'error' ? (
        <p role="alert" className="text-danger text-sm">
          {t(`error.${notice.message}`)}
        </p>
      ) : notice.kind !== 'none' ? (
        <p role="status" className="text-ink-muted text-sm">
          {notice.kind === 'sent'
            ? t('codeSent')
            : notice.kind === 'unlinked'
              ? t('unlinked')
              : t('saved')}
        </p>
      ) : null}
    </section>
  );
}

/** Shown in place of the card when the link could not be loaded. */
export function WhatsAppLinkError() {
  const t = useTranslations('whatsappLink');
  return (
    <p role="alert" className="text-danger text-sm">
      {t('loadError')}
    </p>
  );
}
