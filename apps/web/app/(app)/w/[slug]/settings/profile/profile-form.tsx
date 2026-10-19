'use client';
// Workspace profile form (#284, #25 design spec): name, kind, time zone, default locale and
// practice city with an explicit `Save changes`, enabled only while the form is dirty. The values
// are checked with the same zod schema as the server (`UpdateWorkspaceProfileInput`); a save applies
// at once (optimistic), rolls back if the action fails, and says so in a toast. The slug is read-only
// with a `Rename` dialog for owners (the old slug keeps redirecting for 90 days); everyone else sees
// `Only workspace owners can change this.` Offline, every control is read-only. Unsaved changes are
// guarded on tab close, link clicks and Back (`UnsavedChangesGuard`).
import { LOCALE_LABELS } from '@causedeck/i18n/locales';
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
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
import {
  Slug,
  UpdateWorkspaceProfileInput,
  WORKSPACE_KIND_VALUES,
  WORKSPACE_LOCALE_VALUES,
} from '@causedeck/validators/workspace';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';

import {
  SettingRow,
  settingDescriptionId,
} from '../../../../../../components/settings/setting-row.tsx';
import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import { UnsavedChangesGuard } from '../../../../../../components/settings/unsaved-changes-guard.tsx';
import type { Result } from '../../../../../../lib/safe-action.ts';

import type { ProfileView } from './actions.ts';

/** Time zones offered; the workspace's current zone is added when it is not one of them. */
export const TIME_ZONES = [
  'Asia/Kolkata',
  'Asia/Colombo',
  'Asia/Dhaka',
  'Asia/Kathmandu',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'UTC',
] as const;

/** The row shows the visible label; the field keeps its own for the control, visually hidden. */
const FIELD = 'w-full [&>[data-slot=label]]:sr-only';

type Draft = Omit<ProfileView, 'slug' | 'practiceCity'> & { practiceCity: string };
type FieldName = keyof Draft | 'slug';
type Status = 'idle' | 'saving' | 'saved';

export interface ProfileFormProps {
  workspaceId: string;
  profile: ProfileView;
  /** `workspace.manage`: advocates and owners. */
  canEdit: boolean;
  /** `workspace.rename`: owners only. */
  canRename: boolean;
  save: (input: unknown) => Promise<Result<ProfileView>>;
}

const toDraft = (profile: ProfileView): Draft => ({
  name: profile.name,
  kind: profile.kind,
  timezone: profile.timezone,
  locale: profile.locale,
  practiceCity: profile.practiceCity ?? '',
});

const sameDraft = (a: Draft, b: Draft) =>
  a.name === b.name &&
  a.kind === b.kind &&
  a.timezone === b.timezone &&
  a.locale === b.locale &&
  a.practiceCity === b.practiceCity;

/** Message key under `settings.profile.errors` for an action error code. */
function errorKey(code: string): 'forbidden' | 'slugTaken' | 'invalid' | 'rateLimited' | 'generic' {
  switch (code) {
    case 'FORBIDDEN':
      return 'forbidden';
    case 'CONFLICT':
      return 'slugTaken';
    case 'VALIDATION':
      return 'invalid';
    case 'RATE_LIMITED':
      return 'rateLimited';
    default:
      return 'generic';
  }
}

/** The new URL after a rename: same path on the new slug. */
export function renamedPath(pathname: string, from: string, to: string): string {
  const prefix = `/w/${encodeURIComponent(from)}`;
  return pathname.startsWith(prefix)
    ? `/w/${encodeURIComponent(to)}${pathname.slice(prefix.length)}`
    : `/w/${encodeURIComponent(to)}/settings/profile`;
}

export function ProfileForm({ workspaceId, profile, canEdit, canRename, save }: ProfileFormProps) {
  const t = useTranslations('settings.profile');
  const router = useRouter();
  const online = useOnline();
  const id = useId();
  const [saved, setSaved] = useState<ProfileView>(profile);
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string | undefined>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [renameOpen, setRenameOpen] = useState(false);
  const [slugDraft, setSlugDraft] = useState(profile.slug);

  const readOnly = !canEdit || !online;
  const dirty = canEdit && !sameDraft(draft, toDraft(saved));
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

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  /** Validate, apply optimistically, send; roll back and toast on failure. */
  async function submit(next: ProfileView, slug?: string): Promise<boolean> {
    // The slug goes along only for a rename; a plain save never touches it.
    const parsed = UpdateWorkspaceProfileInput.safeParse({
      name: next.name,
      kind: next.kind,
      timezone: next.timezone,
      locale: next.locale,
      practiceCity: next.practiceCity,
      ...(slug === undefined ? {} : { slug }),
    });
    if (!parsed.success) {
      const found: Partial<Record<FieldName, string | undefined>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName | undefined;
        if (field !== undefined && found[field] === undefined) found[field] = t(`errors.${field}`);
      }
      setErrors(found);
      return false;
    }
    if (!navigator.onLine) {
      toast(t('errors.offline'));
      return false;
    }
    const previous = saved;
    setSaved({ ...next, slug: slug ?? previous.slug });
    setStatus('saving');
    let result: Result<ProfileView>;
    try {
      result = await save({ workspaceId, ...parsed.data });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    if (!result.ok) {
      setSaved(previous);
      setStatus('idle');
      const key = errorKey(result.error.code);
      if (key === 'slugTaken') setErrors({ slug: t('errors.slugTaken') });
      toast(t(`errors.${key}`));
      return false;
    }
    setSaved(result.data);
    setDraft(toDraft(result.data));
    setStatus('saved');
    if (result.data.slug !== previous.slug) {
      toast(t('toast.renamed', { slug: result.data.slug }));
      router.replace(renamedPath(window.location.pathname, previous.slug, result.data.slug));
    } else {
      toast(t('toast.saved'));
    }
    return true;
  }

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!dirty || busy || readOnly) return;
    void submit({ ...draft, slug: saved.slug, practiceCity: draft.practiceCity });
  };

  const onRename = async (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = Slug.safeParse(slugDraft.trim());
    if (!parsed.success) {
      setErrors((current) => ({ ...current, slug: t('errors.slug') }));
      return;
    }
    // Only the slug changes: the saved profile goes with it, never unsaved edits.
    const ok = await submit(saved, parsed.data);
    if (ok) setRenameOpen(false);
  };

  const zones = (TIME_ZONES as readonly string[]).includes(draft.timezone)
    ? TIME_ZONES
    : [draft.timezone, ...TIME_ZONES];
  const ownerOnly = t('ownerOnly');

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      data-slot="profile-form"
      data-dirty={dirty ? '' : undefined}
      aria-describedby={canEdit ? undefined : `${id}-readonly`}
      className="flex flex-col gap-6"
    >
      {canEdit ? null : (
        <p id={`${id}-readonly`} className="text-ink-muted text-sm" data-slot="profile-readonly">
          {t('readOnly')}
        </p>
      )}
      <SettingSection id={`${id}-workspace`} title={t('section')} description={t('sectionHint')}>
        <SettingRow id={`${id}-name`} label={t('name')} description={t('nameHint')}>
          <Field label={t('name')} error={errors.name} readOnly={readOnly} className={FIELD}>
            <Input
              name="name"
              value={draft.name}
              autoComplete="organization"
              aria-describedby={settingDescriptionId(`${id}-name`)}
              onChange={(event) => {
                set('name', event.target.value);
              }}
            />
          </Field>
        </SettingRow>
        <SettingRow id={`${id}-kind`} label={t('kind')} description={t('kindHint')}>
          <Field label={t('kind')} error={errors.kind} readOnly={readOnly} className={FIELD}>
            <Select
              name="kind"
              value={draft.kind}
              onValueChange={(value) => {
                set('kind', value as Draft['kind']);
              }}
            >
              <SelectTrigger aria-describedby={settingDescriptionId(`${id}-kind`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_KIND_VALUES.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </SettingRow>
        <SettingRow id={`${id}-timezone`} label={t('timezone')} description={t('timezoneHint')}>
          <Field
            label={t('timezone')}
            error={errors.timezone}
            readOnly={readOnly}
            className={FIELD}
          >
            <Select
              name="timezone"
              value={draft.timezone}
              onValueChange={(value) => {
                set('timezone', value);
              }}
            >
              <SelectTrigger aria-describedby={settingDescriptionId(`${id}-timezone`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </SettingRow>
        <SettingRow id={`${id}-locale`} label={t('locale')} description={t('localeHint')}>
          <Field label={t('locale')} error={errors.locale} readOnly={readOnly} className={FIELD}>
            <Select
              name="locale"
              value={draft.locale}
              onValueChange={(value) => {
                set('locale', value as Draft['locale']);
              }}
            >
              <SelectTrigger aria-describedby={settingDescriptionId(`${id}-locale`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_LOCALE_VALUES.map((locale) => (
                  <SelectItem key={locale} value={locale} lang={locale}>
                    {LOCALE_LABELS[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </SettingRow>
        <SettingRow id={`${id}-city`} label={t('practiceCity')} description={t('practiceCityHint')}>
          <Field
            label={t('practiceCity')}
            error={errors.practiceCity}
            readOnly={readOnly}
            className={FIELD}
          >
            <Input
              name="practiceCity"
              value={draft.practiceCity}
              autoComplete="address-level2"
              placeholder={t('practiceCityPlaceholder')}
              aria-describedby={settingDescriptionId(`${id}-city`)}
              onChange={(event) => {
                set('practiceCity', event.target.value);
              }}
            />
          </Field>
        </SettingRow>
        <SettingRow
          id={`${id}-slug`}
          label={t('slug')}
          description={t('slugHint')}
          note={canRename ? undefined : ownerOnly}
        >
          <div className="flex w-full items-center justify-between gap-2 md:justify-end">
            <code
              data-slot="workspace-slug"
              aria-describedby={settingDescriptionId(`${id}-slug`)}
              className="bg-surface-sunken min-w-0 truncate rounded px-2 py-1 text-sm"
            >
              {saved.slug}
            </code>
            {canRename ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!online || busy}
                onClick={() => {
                  setSlugDraft(saved.slug);
                  setErrors((current) => ({ ...current, slug: undefined }));
                  setRenameOpen(true);
                }}
              >
                {t('rename')}
              </Button>
            ) : null}
          </div>
        </SettingRow>
      </SettingSection>

      {canEdit ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span role="status" aria-live="polite" className="text-ink-muted text-sm">
            {status === 'saving' ? t('saving') : null}
            {status === 'saved' ? (
              <span className="inline-flex items-center gap-1">
                <Check aria-hidden="true" className="text-success size-4" />
                {t('saved')}
              </span>
            ) : null}
          </span>
          <Button type="submit" disabled={!dirty || busy || !online}>
            {t('save')}
          </Button>
        </div>
      ) : null}

      <UnsavedChangesGuard dirty={dirty} />

      {canRename ? (
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent data-slot="rename-slug-dialog">
            <DialogHeader>
              <DialogTitle>{t('renameTitle')}</DialogTitle>
              <DialogDescription>{t('renameBody')}</DialogDescription>
            </DialogHeader>
            {/* A separate form: the dialog portals out of the profile form. */}
            <form
              noValidate
              id={`${id}-rename`}
              onSubmit={(event) => {
                void onRename(event);
              }}
            >
              <Field label={t('newSlug')} error={errors.slug} hint={t('newSlugHint')}>
                <Input
                  name="slug"
                  value={slugDraft}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setSlugDraft(event.target.value.toLowerCase());
                    setErrors((current) => ({ ...current, slug: undefined }));
                  }}
                />
              </Field>
            </form>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRenameOpen(false);
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                form={`${id}-rename`}
                disabled={busy || slugDraft.trim() === saved.slug}
              >
                {t('renameConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </form>
  );
}

/** Loading state: skeleton rows in the section card. */
export function ProfileSkeleton() {
  const t = useTranslations('settings.profile');
  return (
    <SkeletonGroup labels={{ loading: t('loading') }} data-pattern-state="loading">
      <div className="border-line flex flex-col gap-4 rounded-xl border p-4">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 md:flex-row md:justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full md:w-64" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
