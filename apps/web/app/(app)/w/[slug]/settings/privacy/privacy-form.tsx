'use client';
// Privacy settings form (#286, #25 design spec). India-only AI processing is a switch that is always
// on and disabled, with its explanation as the description and a `Locked on` badge: there is no
// handler and no action field behind it, so no one can turn it off here. Below it, the two settings
// a member with `workspace.manage` (owners and advocates) changes: `Restrict sensitive matters by
// default` (a switch) and `Keep raw audio for` (7, 14 or 30 days). They autosave: a change applies at
// once (optimistic), is sent through `updateWorkspacePrivacyAction`, shows `Saving...` then `Saved`
// for 2 s, and a toast says it was saved with an `Undo` that sends the previous values back. A
// failed save rolls back and says so. Everyone else sees them read-only with a note. Offline, they
// are read-only and the settings layout shows the offline banner.
import { Badge } from '@causedeck/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import { Switch } from '@causedeck/ui/switch';
import { RETENTION_AUDIO_DAYS, type RetentionAudioDays } from '@causedeck/validators/workspace';
import { Check, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import {
  SettingRow,
  settingDescriptionId,
} from '../../../../../../components/settings/setting-row.tsx';
import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import type { Result } from '../../../../../../lib/safe-action.ts';

import type { PrivacySettingsView } from './actions.ts';

type Editable = Pick<PrivacySettingsView, 'sensitiveDefaultRestricted' | 'retentionAudioDays'>;
type Status = 'idle' | 'saving' | 'saved';

const SAVED_MS = 2000;

function editable(settings: PrivacySettingsView): Editable {
  return {
    sensitiveDefaultRestricted: settings.sensitiveDefaultRestricted,
    retentionAudioDays: settings.retentionAudioDays,
  };
}

export interface PrivacyFormProps {
  workspaceId: string;
  settings: PrivacySettingsView;
  /** `workspace.manage`: owners and advocates. */
  canEdit: boolean;
  save: (input: unknown) => Promise<Result<PrivacySettingsView>>;
}

export function PrivacyForm({ workspaceId, settings, canEdit, save }: PrivacyFormProps) {
  const t = useTranslations('settings.privacy');
  const id = useId();
  const online = useOnline();
  const [values, setValues] = useState<Editable>(() => editable(settings));
  // The last saved values, so an undo or a rollback restores what the server holds.
  const saved = useRef<Editable>(editable(settings));
  const [status, setStatus] = useState<Status>('idle');
  const pending = status === 'saving';
  const readOnly = !canEdit || !online;

  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => {
      setStatus('idle');
    }, SAVED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  async function send(next: Editable, previous: Editable, undo: boolean) {
    setValues(next);
    setStatus('saving');
    let result: Result<PrivacySettingsView>;
    try {
      result = await save({ workspaceId, ...next });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    if (!result.ok) {
      setStatus('idle');
      setValues(previous);
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.error'));
      return;
    }
    const stored = editable(result.data);
    saved.current = stored;
    setValues(stored);
    setStatus('saved');
    if (undo) {
      toast(t('toast.undone'));
      return;
    }
    toast(t('toast.saved'), {
      action: {
        label: t('toast.undo'),
        onClick: () => {
          void send(previous, stored, true);
        },
      },
    });
  }

  const onChange = (change: Partial<Editable>) => {
    if (readOnly || pending) return;
    if (!navigator.onLine) {
      toast(t('toast.offline'));
      return;
    }
    const previous = saved.current;
    void send({ ...previous, ...change }, previous, false);
  };

  return (
    <>
      <SettingSection id={`${id}-ai`} title={t('indiaOnly.title')} data-slot="privacy-india-only">
        <SettingRow
          id={`${id}-indiaOnlyAi`}
          label={t('indiaOnly.label')}
          description={t('indiaOnly.description')}
          note={t('indiaOnly.note')}
        >
          <div className="flex items-center gap-2 md:justify-end">
            <Badge tone="neutral" data-slot="india-only-locked">
              <Lock aria-hidden="true" className="size-3" />
              {t('indiaOnly.locked')}
            </Badge>
            <Switch
              name="indiaOnlyAi"
              checked={settings.indiaOnlyAi}
              disabled
              aria-labelledby={`${id}-indiaOnlyAi-label`}
              aria-describedby={settingDescriptionId(`${id}-indiaOnlyAi`)}
            />
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection
        id={`${id}-settings`}
        title={t('settings.title')}
        description={t('settings.description')}
        data-slot="privacy-settings"
      >
        {canEdit ? null : (
          <p className="text-ink-muted py-3 text-sm" data-slot="privacy-settings-readonly">
            {t('settings.readOnly')}
          </p>
        )}
        <SettingRow
          id={`${id}-sensitiveDefaultRestricted`}
          label={t('settings.sensitiveDefaultRestricted.label')}
          description={t('settings.sensitiveDefaultRestricted.description')}
        >
          <Switch
            name="sensitiveDefaultRestricted"
            checked={values.sensitiveDefaultRestricted}
            readOnly={readOnly}
            aria-busy={pending || undefined}
            aria-labelledby={`${id}-sensitiveDefaultRestricted-label`}
            aria-describedby={settingDescriptionId(`${id}-sensitiveDefaultRestricted`)}
            onCheckedChange={(value) => {
              onChange({ sensitiveDefaultRestricted: value });
            }}
          />
        </SettingRow>
        <SettingRow
          id={`${id}-retentionAudioDays`}
          label={t('settings.retentionAudioDays.label')}
          description={t('settings.retentionAudioDays.description')}
        >
          <Select
            name="retentionAudioDays"
            value={String(values.retentionAudioDays)}
            disabled={readOnly}
            onValueChange={(value) => {
              onChange({ retentionAudioDays: Number(value) as RetentionAudioDays });
            }}
          >
            <SelectTrigger
              className="w-full md:w-40"
              aria-busy={pending || undefined}
              aria-labelledby={`${id}-retentionAudioDays-label`}
              aria-describedby={settingDescriptionId(`${id}-retentionAudioDays`)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETENTION_AUDIO_DAYS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {t('settings.retentionAudioDays.option', { days })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <p
          role="status"
          aria-live="polite"
          className="text-ink-muted min-h-5 pt-2 text-right text-sm"
          data-slot="privacy-status"
        >
          {status === 'saving' ? t('saving') : null}
          {status === 'saved' ? (
            <span className="inline-flex items-center gap-1">
              <Check aria-hidden="true" className="text-success size-4" />
              {t('saved')}
            </span>
          ) : null}
        </p>
      </SettingSection>
    </>
  );
}

export function PrivacySkeleton() {
  const t = useTranslations('settings.privacy');
  return (
    <SkeletonGroup labels={{ loading: t('loading') }} data-pattern-state="loading">
      {[1, 2].map((rows) => (
        <div key={rows} className="border-line flex flex-col gap-4 rounded-xl border p-4">
          <Skeleton className="h-6 w-48" />
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 md:flex-row md:justify-between">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      ))}
    </SkeletonGroup>
  );
}
