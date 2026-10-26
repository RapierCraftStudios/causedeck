'use client';
// The language a client wants messages in (#82): the seven LANGUAGE_PREFS, labelled in the
// `people.languages` catalog. A native select, so it works with a keyboard and on phones.
import { Field } from '@causedeck/ui/field';
import { LANGUAGE_PREFS, type LanguagePref } from '@causedeck/validators/client-contact';
import { useTranslations } from 'next-intl';

export interface LanguagePrefFieldProps {
  value: LanguagePref;
  onChange: (value: LanguagePref) => void;
  disabled?: boolean;
}

export function LanguagePrefField({ value, onChange, disabled = false }: LanguagePrefFieldProps) {
  const t = useTranslations('people');
  return (
    <Field label={t('language.label')} hint={t('language.hint')}>
      <select
        data-contact-field="language"
        className="border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = LANGUAGE_PREFS.find((l) => l === event.target.value);
          if (next !== undefined) onChange(next);
        }}
      >
        {LANGUAGE_PREFS.map((code) => (
          <option key={code} value={code}>
            {t(`languages.${code}`)}
          </option>
        ))}
      </select>
    </Field>
  );
}
