'use client';
// The courts index's `Add forum` (#402, #42): owners and advocates add a workspace-owned A0 forum
// (the page renders this only when `can(role, 'workspace.manage')`; the server action checks again).
// Fields: name, court type, city, main and other languages, an optional https website, and a code
// suggested from city and name until the lawyer edits it. A code already in the courts index (a
// catalogue forum's or one of the workspace's) is blocked here; the server's CONFLICT is the final
// word. On success the dialog closes, a toast confirms and the page refreshes so the forum shows
// under its city. `Esc` closes the dialog and focus returns to `Add forum` (Radix).
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Checkbox } from '@causedeck/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@causedeck/ui/dialog';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { toast } from '@causedeck/ui/sonner';
import { FORUM_CODE_PATTERN } from '@causedeck/validators/forum';
import { JURISDICTION_KINDS } from '@causedeck/validators/matter-graph';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { suggestForumCode, websiteHost } from '../../lib/forum-input.ts';
import type { Result } from '../../lib/safe-action.ts';

/** Languages a custom forum's lists and orders come in. */
export const FORUM_LANGUAGES = ['en', 'ta', 'kn', 'hi'] as const;
type ForumLanguage = (typeof FORUM_LANGUAGES)[number];
type JurisdictionKind = (typeof JURISDICTION_KINDS)[number];

export interface AddForumInput {
  workspaceId: string;
  code: string;
  name: string;
  jurisdictionKind: JurisdictionKind;
  city: string;
  primaryLanguage: string;
  secondaryLanguages?: string[];
  website?: string;
}

export interface AddForumDialogProps {
  workspaceId: string;
  /** Every code in the courts index: catalogue forums and the workspace's own. */
  takenCodes: readonly string[];
  action: (input: AddForumInput) => Promise<Result<{ code: string; court: string }>>;
  /** Open on mount: `Add forum` was clicked before this chunk loaded (`add-forum.tsx`, #427). */
  defaultOpen?: boolean;
}

type FieldName = 'name' | 'city' | 'code' | 'website';
type Errors = Partial<Record<FieldName, string>>;

const SELECT_CLASS =
  'border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm disabled:opacity-50';

export function AddForumDialog({
  workspaceId,
  takenCodes,
  action,
  defaultOpen = false,
}: AddForumDialogProps) {
  const t = useTranslations('courts.addForum');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<JurisdictionKind>('district');
  const [city, setCity] = useState('');
  const [primary, setPrimary] = useState<ForumLanguage>('en');
  const [secondary, setSecondary] = useState<ForumLanguage[]>([]);
  const [website, setWebsite] = useState('');
  const [code, setCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const shownCode = codeEdited ? code : suggestForumCode(city, name);

  function reset() {
    setName('');
    setKind('district');
    setCity('');
    setPrimary('en');
    setSecondary([]);
    setWebsite('');
    setCode('');
    setCodeEdited(false);
    setErrors({});
    setFormError(null);
  }

  function validate(): Errors {
    const next: Errors = {};
    if (name.trim() === '') next.name = t('errors.required');
    if (city.trim() === '') next.city = t('errors.required');
    const value = shownCode.trim();
    if (value === '') next.code = t('errors.required');
    else if (!FORUM_CODE_PATTERN.test(value)) next.code = t('errors.codeInvalid');
    else if (takenCodes.includes(value)) next.code = t('errors.codeTaken');
    if (website.trim() !== '' && websiteHost(website) === null) {
      next.website = t('errors.websiteInvalid');
    }
    return next;
  }

  async function onSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (pending) return;
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    const others = secondary.filter((language) => language !== primary);
    let result: Result<{ code: string; court: string }>;
    try {
      result = await action({
        workspaceId,
        code: shownCode.trim(),
        name: name.trim(),
        jurisdictionKind: kind,
        city: city.trim(),
        primaryLanguage: primary,
        ...(others.length > 0 ? { secondaryLanguages: others } : {}),
        ...(website.trim() === '' ? {} : { website: website.trim() }),
      });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (result.ok) {
      setOpen(false);
      reset();
      toast(t('created', { name: result.data.court }));
      router.refresh();
      return;
    }
    const { code: errorCode, fieldErrors } = result.error;
    if (errorCode === 'CONFLICT') {
      setErrors({ code: t('errors.codeTaken') });
    } else if (errorCode === 'VALIDATION' && fieldErrors?.website) {
      setErrors({ website: t('errors.websiteInvalid') });
    } else if (errorCode === 'VALIDATION' && fieldErrors?.code) {
      setErrors({ code: t('errors.codeInvalid') });
    } else if (errorCode === 'FORBIDDEN') {
      setFormError(t('errors.forbidden'));
    } else {
      setFormError(t('errors.failed'));
    }
  }

  const formId = `${id}-form`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" data-slot="add-forum" className="self-start">
          <Plus aria-hidden="true" />
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent data-slot="add-forum-dialog">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {formError === null ? null : (
          <Alert tone="danger" role="alert">
            {formError}
          </Alert>
        )}

        <form
          noValidate
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(event) => void onSubmit(event)}
        >
          <Field label={t('name.label')} required error={errors.name}>
            <Input
              autoComplete="off"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <Field label={t('courtType.label')} required controlId={`${id}-kind`}>
            <select
              id={`${id}-kind`}
              data-slot="add-forum-kind"
              className={SELECT_CLASS}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as JurisdictionKind);
              }}
            >
              {JURISDICTION_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`courtType.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('city.label')} required error={errors.city}>
            <Input
              autoComplete="off"
              value={city}
              onChange={(event) => {
                setCity(event.target.value);
              }}
            />
          </Field>
          <Field label={t('primaryLanguage')} required controlId={`${id}-primary`}>
            <select
              id={`${id}-primary`}
              data-slot="add-forum-primary"
              className={SELECT_CLASS}
              value={primary}
              onChange={(event) => {
                setPrimary(event.target.value as ForumLanguage);
              }}
            >
              {FORUM_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t(`languages.${language}`)}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">{t('secondaryLanguages')}</legend>
            <div className="flex flex-wrap gap-4">
              {FORUM_LANGUAGES.filter((language) => language !== primary).map((language) => (
                <div key={language} className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-lang-${language}`}
                    checked={secondary.includes(language)}
                    onCheckedChange={(checked) => {
                      setSecondary((current) =>
                        checked === true
                          ? [...current.filter((value) => value !== language), language]
                          : current.filter((value) => value !== language),
                      );
                    }}
                  />
                  <label htmlFor={`${id}-lang-${language}`} className="text-sm">
                    {t(`languages.${language}`)}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
          <Field label={t('website.label')} hint={t('website.hint')} error={errors.website}>
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              value={website}
              onChange={(event) => {
                setWebsite(event.target.value);
              }}
            />
          </Field>
          <Field label={t('code.label')} hint={t('code.hint')} required error={errors.code}>
            <Input
              autoComplete="off"
              spellCheck={false}
              value={shownCode}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeEdited(true);
              }}
            />
          </Field>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={pending}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
