'use client';
// One integrations card (#287, #25 design spec): the private
// ICS feed URL. The value is a read-only field that shows the masked placeholder, because only the
// token's hash is stored. Below it, the token's status (`Not created yet`, or when it was created
// and last rotated) and the action:
//   * flag off: a `Not enabled yet` badge, and the button is disabled with that reason;
//   * offline: the button is disabled with `Settings can be changed when you are back online.`;
//   * no token yet: `Create` makes the first one at once;
//   * a token exists: `Rotate` asks first (the old address or URL stops working at once).
// After a create or a rotate, the full value is shown once with `Copy` (announced as `Copied`) and
// a note that it will not be shown again; a reload shows the placeholder again. A failed rotate
// says so in a toast and changes nothing.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@causedeck/ui/alert-dialog';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import { Check, Copy } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  DisabledWithReason,
  disabledReasonId,
} from '../../../../../../components/settings/disabled-with-reason.tsx';
import {
  SettingRow,
  settingDescriptionId,
} from '../../../../../../components/settings/setting-row.tsx';
import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import type { Result } from '../../../../../../lib/safe-action.ts';

import type { RotatedIntegration } from './actions.ts';
import type { IntegrationKind } from './integration-values.ts';

export interface IntegrationTokenStatus {
  createdAt: Date;
  rotatedAt: Date | null;
}

export type RotateIntegration = (input: unknown) => Promise<Result<RotatedIntegration>>;

export interface IntegrationCardProps {
  workspaceId: string;
  kind: IntegrationKind;
  /** The masked address or URL (the token is never shown again). */
  masked: string;
  status: IntegrationTokenStatus | null;
  /** The kind's feature flag. */
  enabled: boolean;
  rotate: RotateIntegration;
}

/** `emailIntake` / `icsFeed`: the card's keys under `settings.integrations`. */
const SECTION = { ics_feed: 'icsFeed' } as const;

export function IntegrationCard({
  workspaceId,
  kind,
  masked,
  status: initialStatus,
  enabled,
  rotate,
}: IntegrationCardProps) {
  const t = useTranslations('settings.integrations');
  const format = useFormatter();
  const online = useOnline();
  const section = SECTION[kind];
  const id = `integration-${kind}`;
  const [status, setStatus] = useState(initialStatus);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const reason = !enabled ? t('notEnabledReason') : online ? null : t('offlineReason');
  const label = status ? t('rotate') : t('create');
  const date = (value: Date) => format.dateTime(value, { dateStyle: 'medium' });

  async function send() {
    if (!navigator.onLine) {
      toast(t('offlineReason'));
      return;
    }
    setPending(true);
    let result: Result<RotatedIntegration>;
    try {
      result = await rotate({ workspaceId, kind });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    setConfirming(false);
    if (!result.ok) {
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.error'));
      return;
    }
    setStatus({ createdAt: result.data.createdAt, rotatedAt: result.data.rotatedAt });
    setRevealed(result.data.value);
    setCopied(false);
    toast(t(status ? 'toast.rotated' : 'toast.created'));
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast(t('toast.copyFailed'));
    }
  }

  const button = (
    <Button
      id={`${id}-action`}
      variant="secondary"
      disabled={reason !== null || pending}
      aria-busy={pending || undefined}
      aria-describedby={[settingDescriptionId(id), reason === null ? null : disabledReasonId(id)]
        .filter(Boolean)
        .join(' ')}
      data-slot="integration-rotate"
      className="w-full md:w-auto"
      onClick={() => {
        if (status) setConfirming(true);
        else void send();
      }}
    >
      {label}
    </Button>
  );

  return (
    <SettingSection
      id={`${id}-section`}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t(`${section}.title`)}
          {enabled ? null : (
            <Badge tone="neutral" data-slot="integration-not-enabled">
              {t('notEnabled')}
            </Badge>
          )}
        </span>
      }
      description={t(`${section}.description`)}
      data-slot={`integration-${kind}`}
    >
      <div className="flex min-w-0 flex-col gap-2 py-3">
        <label htmlFor={`${id}-value`} className="text-sm font-medium">
          {t(`${section}.label`)}
        </label>
        <div className="flex min-w-0 flex-col gap-2 md:flex-row">
          <Input
            id={`${id}-value`}
            readOnly
            value={revealed ?? masked}
            data-slot="integration-value"
            data-revealed={revealed === null ? undefined : 'true'}
            className="min-w-0 flex-1 font-mono tabular-nums"
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          {revealed === null ? null : (
            <Button
              variant="secondary"
              data-slot="integration-copy"
              className="w-full md:w-auto"
              onClick={() => {
                void copy(revealed);
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? t('copied') : t('copy')}
            </Button>
          )}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {copied ? t('copied') : ''}
        </p>
        {revealed === null ? null : (
          <p className="text-warning text-sm" data-slot="integration-shown-once">
            {t('shownOnce')}
          </p>
        )}
      </div>
      <SettingRow
        id={id}
        label={t('tokenLabel')}
        description={
          status === null
            ? t('notCreated')
            : status.rotatedAt === null
              ? t('createdOn', { date: date(status.createdAt) })
              : t('rotatedOn', { date: date(status.rotatedAt) })
        }
      >
        {reason === null ? (
          button
        ) : (
          <DisabledWithReason id={id} reason={reason}>
            {button}
          </DisabledWithReason>
        )}
      </SettingRow>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!pending) setConfirming(open);
        }}
      >
        <AlertDialogContent data-dialog="rotate-integration">
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${section}.rotateTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${section}.rotateBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('rotateCancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!online || pending}
              aria-busy={pending || undefined}
              onClick={(event) => {
                // Keep the dialog open until the rotation resolves.
                event.preventDefault();
                void send();
              }}
            >
              {pending ? t('rotating') : t('rotateConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingSection>
  );
}

export function IntegrationsSkeleton() {
  const t = useTranslations('settings.integrations');
  return (
    <SkeletonGroup labels={{ loading: t('loading') }} data-pattern-state="loading">
      {[1, 2].map((card) => (
        <div key={card} className="border-line flex flex-col gap-4 rounded-xl border p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-full" />
          <div className="flex flex-col gap-2 md:flex-row md:justify-between">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}
