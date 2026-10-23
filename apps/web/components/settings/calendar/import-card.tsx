'use client';
// The calendar-file import card (#53; PRD CA-5): choose an `.ics` file, send it to the capture
// inbox as channel `ics` (`POST /api/captures`, 1 MB cap) and open its review. Nothing is read in
// the browser. A file with the same bytes as an earlier import says so; a workspace that has not
// switched the channel on is told who can. States: idle, sending, a failure line, and offline
// (the control is disabled with the reason).
import { Button } from '@causedeck/ui/button';
import { toast } from '@causedeck/ui/sonner';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { SettingSection } from '../setting-section.tsx';
import { useOnline } from '../settings-offline-banner.tsx';

export type CalendarUpload =
  | { ok: true; captureId: string; duplicate: boolean }
  | { ok: false; error: 'channel_off' | 'too_large' | 'invalid' | 'forbidden' | 'failed' };

/** The multipart upload to `POST /api/captures` with channel `ics`. */
export async function uploadCalendarFile(workspaceId: string, file: File): Promise<CalendarUpload> {
  const form = new FormData();
  form.set('workspaceId', workspaceId);
  form.set('channel', 'ics');
  form.set('file', file);
  try {
    const response = await fetch('/api/captures', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    if (response.ok) {
      const body = (await response.json()) as { captureId: string; status?: string };
      return { ok: true, captureId: body.captureId, duplicate: body.status === 'duplicate' };
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'channel_disabled') return { ok: false, error: 'channel_off' };
    if (response.status === 413) return { ok: false, error: 'too_large' };
    if (response.status === 400 || response.status === 415) return { ok: false, error: 'invalid' };
    if (response.status === 403) return { ok: false, error: 'forbidden' };
    return { ok: false, error: 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

export interface ImportCardProps {
  workspaceId: string;
  /** Where the review of a capture lives. */
  reviewHref: (captureId: string) => string;
  upload?: (workspaceId: string, file: File) => Promise<CalendarUpload>;
}

const ERROR_KEY = {
  channel_off: 'channelOff',
  too_large: 'tooLarge',
  invalid: 'invalid',
  forbidden: 'forbidden',
  failed: 'failed',
} as const;

export function ImportCard({
  workspaceId,
  reviewHref,
  upload = uploadCalendarFile,
}: ImportCardProps) {
  const t = useTranslations('calendar.import');
  const tf = useTranslations('calendar.feed');
  const router = useRouter();
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<keyof typeof ERROR_KEY | null>(null);

  async function send(file: File) {
    setFailure(null);
    setSending(true);
    const result = await upload(workspaceId, file);
    setSending(false);
    if (input.current) input.current.value = '';
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    toast(t(result.duplicate ? 'duplicate' : 'received'));
    router.push(reviewHref(result.captureId));
  }

  return (
    <SettingSection
      id="calendar-import"
      title={t('title')}
      description={t('description')}
      data-slot="calendar-import"
    >
      <div className="flex flex-col gap-3 py-3">
        <p className="text-ink-muted text-sm">{t('instructions')}</p>
        <input
          ref={input}
          type="file"
          accept=".ics,text/calendar"
          className="sr-only"
          id="calendar-import-file"
          data-slot="calendar-import-file"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void send(file);
          }}
        />
        <Button
          variant="secondary"
          className="w-full md:w-auto md:self-start"
          disabled={sending || !online}
          aria-busy={sending || undefined}
          data-slot="calendar-import-choose"
          onClick={() => {
            input.current?.click();
          }}
        >
          {sending ? t('uploading') : t('choose')}
        </Button>
        {online ? null : <p className="text-ink-muted text-xs">{tf('offline')}</p>}
        {failure === null ? null : (
          <p role="alert" className="text-danger text-sm" data-slot="calendar-import-error">
            {t(ERROR_KEY[failure])}
          </p>
        )}
      </div>
    </SettingSection>
  );
}
