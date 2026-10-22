'use client';
// The email channel card (#54): the plain-language note on where forwarded email goes (India
// region; client emails excluded unless forwarded on purpose) and the button that turns the `email`
// capture channel on, recording that the member saw the note. States: flag off (`Not enabled yet`,
// button disabled with that reason), offline (disabled with the reason), on (no button).
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { toast } from '@causedeck/ui/sonner';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DisabledWithReason, disabledReasonId } from '../disabled-with-reason.tsx';
import { SettingSection } from '../setting-section.tsx';
import { useOnline } from '../settings-offline-banner.tsx';

import type { ActionFn } from './types.ts';

export interface ChannelCardProps {
  workspaceId: string;
  /** The `capture.email-forward` flag. */
  enabled: boolean;
  /** Whether the `email` capture channel is on. */
  channelOn: boolean;
  enable: ActionFn<{ enabled: boolean; disclosureVersion: string | null }>;
}

export function ChannelCard({ workspaceId, enabled, channelOn: initialOn, enable }: ChannelCardProps) {
  const t = useTranslations('emailIntake');
  const online = useOnline();
  const [on, setOn] = useState(initialOn);
  const [pending, setPending] = useState(false);
  const reason = !enabled ? t('notEnabledReason') : online ? null : t('offlineReason');

  async function send() {
    if (!navigator.onLine) {
      toast(t('offlineReason'));
      return;
    }
    setPending(true);
    let result: Awaited<ReturnType<typeof enable>>;
    try {
      result = await enable({ workspaceId });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.error'));
      return;
    }
    setOn(result.data.enabled);
    toast(t('toast.enabled'));
  }

  const button = (
    <Button
      id="email-channel-action"
      variant="secondary"
      disabled={reason !== null || pending}
      aria-busy={pending || undefined}
      aria-describedby={reason === null ? undefined : disabledReasonId('email-channel')}
      className="w-full md:w-auto"
      onClick={() => {
        void send();
      }}
    >
      {pending ? t('channel.enabling') : t('channel.enable')}
    </Button>
  );

  return (
    <SettingSection
      id="email-channel-section"
      data-slot="email-channel"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t('channel.title')}
          {enabled ? null : (
            <Badge tone="neutral" data-slot="email-not-enabled">
              {t('notEnabled')}
            </Badge>
          )}
        </span>
      }
      description={t('channel.disclosure')}
    >
      <div className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
        <p role="status" className="text-sm font-medium" data-slot="email-channel-state">
          {on ? t('channel.on') : t('channel.off')}
        </p>
        {on ? null : (
          <DisabledWithReason id="email-channel" reason={reason}>
            {button}
          </DisabledWithReason>
        )}
      </div>
    </SettingSection>
  );
}
