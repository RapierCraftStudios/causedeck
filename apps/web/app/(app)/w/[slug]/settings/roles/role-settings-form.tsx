'use client';
// Role settings form (#285, #25 design spec): two switches, `Advocates can invite members` and
// `Owners see restricted matters`. They autosave: a change applies at once (optimistic), is sent
// through `updateRoleSettingsAction`, and a toast says it was saved with an `Undo` that sends the
// previous value back. A failed save rolls back and says so. Only owners (`member.role`) can change
// them; everyone else sees them read-only with a note. Offline, the switches are read-only and the
// settings layout shows the offline banner.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import { Switch } from '@causedeck/ui/switch';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

import {
  SettingRow,
  settingDescriptionId,
} from '../../../../../../components/settings/setting-row.tsx';
import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import type { Result } from '../../../../../../lib/safe-action.ts';

import type { RoleSettingsView } from './actions.ts';

type Field = keyof RoleSettingsView;

const FIELDS: readonly Field[] = ['advocatesCanInvite', 'ownersSeeRestrictedMatters'];

export interface RoleSettingsFormProps {
  workspaceId: string;
  settings: RoleSettingsView;
  /** `member.role`: owners only. */
  canEdit: boolean;
  save: (input: unknown) => Promise<Result<RoleSettingsView>>;
}

export function RoleSettingsForm({ workspaceId, settings, canEdit, save }: RoleSettingsFormProps) {
  const t = useTranslations('settings.roles');
  const id = useId();
  const online = useOnline();
  const [values, setValues] = useState<RoleSettingsView>(settings);
  // The last saved values, so an undo or a rollback restores what the server holds.
  const saved = useRef<RoleSettingsView>(settings);
  const [pending, setPending] = useState(false);
  const readOnly = !canEdit || !online;

  async function send(next: RoleSettingsView, previous: RoleSettingsView, undo: boolean) {
    setValues(next);
    setPending(true);
    let result: Result<RoleSettingsView>;
    try {
      result = await save({ workspaceId, ...next });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      setValues(previous);
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.error'));
      return;
    }
    saved.current = result.data;
    setValues(result.data);
    if (undo) {
      toast(t('toast.undone'));
      return;
    }
    toast(t('toast.saved'), {
      action: {
        label: t('toast.undo'),
        onClick: () => {
          void send(previous, result.data, true);
        },
      },
    });
  }

  const onChange = (field: Field, value: boolean) => {
    if (readOnly || pending) return;
    if (!navigator.onLine) {
      toast(t('toast.offline'));
      return;
    }
    const previous = saved.current;
    void send({ ...previous, [field]: value }, previous, false);
  };

  return (
    <SettingSection
      id={`${id}-settings`}
      title={t('settings.title')}
      description={t('settings.description')}
      data-slot="role-settings"
    >
      {canEdit ? null : (
        <p className="text-ink-muted py-3 text-sm" data-slot="role-settings-readonly">
          {t('settings.readOnly')}
        </p>
      )}
      {FIELDS.map((field) => (
        <SettingRow
          key={field}
          id={`${id}-${field}`}
          label={t(`settings.${field}.label`)}
          description={t(`settings.${field}.description`)}
        >
          <Switch
            name={field}
            checked={values[field]}
            readOnly={readOnly}
            aria-busy={pending || undefined}
            aria-labelledby={`${id}-${field}-label`}
            aria-describedby={settingDescriptionId(`${id}-${field}`)}
            onCheckedChange={(value) => {
              onChange(field, value);
            }}
          />
        </SettingRow>
      ))}
    </SettingSection>
  );
}

export function RolesSkeleton() {
  const t = useTranslations('settings.roles');
  return (
    <SkeletonGroup labels={{ loading: t('loading') }} data-pattern-state="loading">
      <div className="border-line flex flex-col gap-4 rounded-xl border p-4">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 md:flex-row md:justify-between">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-9" />
          </div>
        ))}
      </div>
      <div className="border-line flex flex-col gap-3 rounded-xl border p-4">
        <Skeleton className="h-6 w-56" />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </SkeletonGroup>
  );
}
