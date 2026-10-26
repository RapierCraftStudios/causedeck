'use client';
// The account profile form (#289, #25 design spec): display name with an explicit `Save changes`
// (enabled while dirty, zod-checked like the server, guarded against leaving with unsaved edits),
// the initials avatar (photo upload comes later), the sign-in email (read-only) and the UI
// language, which applies at once through the shell's locale switch (`setLocaleAction`, saved on
// the user). Offline, every control is read-only.
import { LOCALE_LABELS, LOCALES } from '@causedeck/i18n/locales';
import { Avatar } from '@causedeck/ui/avatar';
import { Button } from '@causedeck/ui/button';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@causedeck/ui/select';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';

import { useLocaleSwitch } from '../../../../components/locale-switcher.tsx';
import { SettingRow, settingDescriptionId } from '../../../../components/settings/setting-row.tsx';
import { SettingSection } from '../../../../components/settings/setting-section.tsx';
import { useOnline } from '../../../../components/settings/settings-offline-banner.tsx';
import { UnsavedChangesGuard } from '../../../../components/settings/unsaved-changes-guard.tsx';
import type { Result } from '../../../../lib/safe-action.ts';

import type { AccountProfileOutcome } from '../actions.ts';

/** Same rule as `updateAccountProfileAction`. */
const NameInput = z.string().trim().min(1).max(120);

/** The row shows the visible label; the field keeps its own for the control, visually hidden. */
const FIELD = 'w-full [&>[data-slot=label]]:sr-only';

type Status = 'idle' | 'saving' | 'saved';

export interface AccountProfileFormProps {
  name: string;
  email: string;
  save: (input: { name: string }) => Promise<Result<AccountProfileOutcome>>;
}

export function AccountProfileForm({ name, email, save }: AccountProfileFormProps) {
  const t = useTranslations('settings.account');
  const router = useRouter();
  const online = useOnline();
  const id = useId();
  const { locale, pending: localePending, change } = useLocaleSwitch();
  const [saved, setSaved] = useState(name);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>('idle');

  const dirty = draft.trim() !== saved;
  const busy = status === 'saving';

  // `Saved` shows for 2 s.
  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => {
      setStatus('idle');
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  async function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (!dirty || busy || !online) return;
    const parsed = NameInput.safeParse(draft);
    if (!parsed.success) {
      setError(t('profile.errors.name'));
      return;
    }
    if (!navigator.onLine) {
      toast(t('offline'));
      return;
    }
    setStatus('saving');
    let result: Result<AccountProfileOutcome>;
    try {
      result = await save({ name: parsed.data });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    if (!result.ok) {
      setStatus('idle');
      if (result.error.code === 'VALIDATION') setError(t('profile.errors.name'));
      toast(result.error.code === 'FORBIDDEN' ? t('forbidden') : t('profile.errors.generic'));
      return;
    }
    setSaved(result.data.name);
    setDraft(result.data.name);
    setStatus('saved');
    toast(t('profile.toast.saved'));
    router.refresh();
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      data-slot="account-profile-form"
      data-dirty={dirty ? '' : undefined}
      className="flex flex-col gap-4"
    >
      <SettingSection
        id={`${id}-profile`}
        title={t('profile.title')}
        description={t('profile.description')}
      >
        <SettingRow
          id={`${id}-avatar`}
          label={t('profile.avatar')}
          description={t('profile.avatarHint')}
        >
          <Avatar name={saved || email} size="lg" data-slot="account-avatar" />
        </SettingRow>
        <SettingRow id={`${id}-name`} label={t('profile.name')} description={t('profile.nameHint')}>
          <Field label={t('profile.name')} error={error} readOnly={!online} className={FIELD}>
            <Input
              name="name"
              value={draft}
              autoComplete="name"
              aria-describedby={settingDescriptionId(`${id}-name`)}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(undefined);
              }}
            />
          </Field>
        </SettingRow>
        <SettingRow
          id={`${id}-email`}
          label={t('profile.email')}
          description={t('profile.emailHint')}
        >
          <span
            data-slot="account-email"
            aria-describedby={settingDescriptionId(`${id}-email`)}
            className="min-w-0 text-sm break-all"
          >
            {email}
          </span>
        </SettingRow>
        <SettingRow
          id={`${id}-language`}
          label={t('profile.language')}
          description={t('profile.languageHint')}
        >
          <Field label={t('profile.language')} readOnly={!online} className={FIELD}>
            <Select
              name="language"
              value={locale}
              disabled={!online || localePending}
              onValueChange={change}
            >
              <SelectTrigger aria-describedby={settingDescriptionId(`${id}-language`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((option) => (
                  <SelectItem key={option} value={option} lang={option}>
                    {LOCALE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </SettingRow>
      </SettingSection>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span role="status" aria-live="polite" className="text-ink-muted text-sm">
          {status === 'saving' ? t('profile.saving') : null}
          {status === 'saved' ? (
            <span className="inline-flex items-center gap-1">
              <Check aria-hidden="true" className="text-success size-4" />
              {t('profile.saved')}
            </span>
          ) : null}
        </span>
        <Button type="submit" disabled={!dirty || busy || !online}>
          {t('profile.save')}
        </Button>
      </div>

      <UnsavedChangesGuard dirty={dirty} />
    </form>
  );
}

/** Loading state: skeleton section cards. */
export function AccountSkeleton() {
  const t = useTranslations('settings.account');
  return (
    <SkeletonGroup labels={{ loading: t('loading') }} data-pattern-state="loading">
      <div className="flex flex-col gap-4">
        {Array.from({ length: 2 }, (_, card) => (
          <div key={card} className="border-line flex flex-col gap-4 rounded-xl border p-4">
            <Skeleton className="h-6 w-40" />
            {Array.from({ length: 3 }, (_, row) => (
              <div key={row} className="flex flex-col gap-2 md:flex-row md:justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-full md:w-64" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
