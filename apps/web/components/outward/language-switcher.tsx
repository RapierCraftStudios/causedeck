'use client';
// EN / தமிழ் / ಕನ್ನಡ segmented control (#736). Each segment is named in full for assistive tech
// and carries the language's own lang attribute so the script renders with the right font.
import { LANGUAGES, type Language } from '@causedeck/validators/outward-draft';
import { ToggleGroup, ToggleGroupItem } from '@causedeck/ui/toggle-group';
import { useTranslations } from 'next-intl';

/** Each language's own name: fixed text in its own script, not a translatable string. */
export const LANGUAGE_LABELS: Record<Language, string> = { en: 'EN', ta: 'தமிழ்', kn: 'ಕನ್ನಡ' };

export interface LanguageSwitcherProps {
  value: Language;
  onChange: (language: Language) => void;
  disabled?: boolean;
}

export function LanguageSwitcher({ value, onChange, disabled = false }: LanguageSwitcherProps) {
  const t = useTranslations('outward');
  return (
    <ToggleGroup
      type="single"
      value={value}
      disabled={disabled}
      aria-label={t('language.label')}
      onValueChange={(next) => {
        if (next !== '' && next !== value) onChange(next as Language);
      }}
    >
      {LANGUAGES.map((language) => (
        <ToggleGroupItem
          key={language}
          value={language}
          lang={language}
          aria-label={t(`language.${language}Name`)}
          className="pointer-coarse:min-h-11"
        >
          {LANGUAGE_LABELS[language]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
