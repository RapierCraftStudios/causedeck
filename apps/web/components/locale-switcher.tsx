'use client';

// The UI language switcher (#175): English, தமிழ், ಕನ್ನಡ, each labelled in its own script. Three
// placements share one change flow: a radio group in the shell user menu (the lazy Radix overlays
// passed in), a native radio list in the phone More sheet, and a compact globe button in the
// sign-in footer. The compact form uses native elements only, so no Radix code joins the sign-in
// route's 180 KB initial-JS budget.
import { LOCALE_LABELS, LOCALES, isLocale, type Locale } from '@causedeck/i18n/locales';
import { Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ComponentType,
  type ReactNode,
} from 'react';

import { setLocaleAction } from '../app/(app)/account/actions.ts';

async function showToast(kind: 'success' | 'error', message: string, lang: Locale) {
  // Sonner loads on first use: no toast exists on first paint (see lazy-toaster.tsx).
  const { toast } = await import('@causedeck/ui/sonner');
  toast[kind](<span lang={lang}>{message}</span>);
}

/**
 * The active locale and a `change` that persists the choice (user record when signed in, cookie
 * always), refreshes the server-rendered tree in place (no full reload, client state survives) and
 * confirms with a toast in the new language.
 */
export function useLocaleSwitch() {
  const active = useLocale();
  const current: Locale = isLocale(active) ? active : 'en';
  // The picked option shows as checked at once; it settles on the server's answer when the
  // transition ends (and reverts if saving failed).
  const [locale, setOptimisticLocale] = useOptimistic(current);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (!isLocale(next) || next === locale) return;
    startTransition(async () => {
      setOptimisticLocale(next);
      const result = await setLocaleAction({ locale: next });
      if (!result.ok) {
        await showToast('error', result.error.message, current);
        return;
      }
      router.refresh();
      await showToast('success', result.data.message, next);
    });
  }

  return { locale, pending, change };
}

/** Native radio inputs: Tab reaches the group, arrow keys move the choice. */
function LocaleRadioList({
  locale,
  pending,
  onChange,
  legend,
  legendClassName,
}: {
  locale: Locale;
  pending: boolean;
  onChange: (next: string) => void;
  legend: ReactNode;
  legendClassName: string;
}) {
  const name = useId();
  return (
    <fieldset data-locale-switcher="list" aria-busy={pending} className="flex flex-col gap-0.5">
      <legend className={legendClassName}>{legend}</legend>
      {LOCALES.map((option) => (
        <label
          key={option}
          lang={option}
          className="text-ink hover:bg-accent-soft/60 has-focus-visible:outline-ring flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm font-medium has-focus-visible:outline-2"
        >
          <input
            type="radio"
            name={name}
            value={option}
            checked={option === locale}
            data-locale-option={option}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
            className="accent-accent size-4 shrink-0 outline-none"
          />
          {LOCALE_LABELS[option]}
        </label>
      ))}
    </fieldset>
  );
}

/** The Radix menu radio primitives, from the shell's lazily loaded overlays. */
export interface MenuRadioPrimitives {
  RadioGroup: ComponentType<{
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }>;
  RadioItem: ComponentType<{
    value: string;
    lang: string;
    'data-locale-option': string;
    children: ReactNode;
  }>;
}

export type LocaleSwitcherProps =
  { variant: 'menu'; menu: MenuRadioPrimitives } | { variant: 'list' } | { variant: 'compact' };

export function LocaleSwitcher(props: LocaleSwitcherProps) {
  const t = useTranslations('locale');
  const { locale, pending, change } = useLocaleSwitch();

  if (props.variant === 'menu') {
    const { RadioGroup, RadioItem } = props.menu;
    return (
      <RadioGroup value={locale} onValueChange={change}>
        {LOCALES.map((option) => (
          <RadioItem key={option} value={option} lang={option} data-locale-option={option}>
            {LOCALE_LABELS[option]}
          </RadioItem>
        ))}
      </RadioGroup>
    );
  }

  if (props.variant === 'list') {
    return (
      <LocaleRadioList
        locale={locale}
        pending={pending}
        onChange={change}
        legend={t('label')}
        legendClassName="text-eyebrow text-ink-subtle px-2 pb-1 font-medium tracking-[0.08em] uppercase"
      />
    );
  }

  return <CompactLocaleSwitcher locale={locale} pending={pending} onChange={change} />;
}

/** A globe button showing the active language; opens the radio list above it. */
function CompactLocaleSwitcher({
  locale,
  pending,
  onChange,
}: {
  locale: Locale;
  pending: boolean;
  onChange: (next: string) => void;
}) {
  const t = useTranslations('locale');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    // Move focus to the checked option, as a menu would.
    rootRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      data-locale-switcher="compact"
      className="relative self-start"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="text-ink-muted hover:text-ink focus-visible:outline-ring inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 outline-none focus-visible:outline-2"
      >
        <Globe aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="sr-only">{t('label')}:</span>{' '}
        <span lang={locale}>{LOCALE_LABELS[locale]}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="bg-surface-raised border-line absolute bottom-full left-0 z-50 mb-1 w-48 rounded-lg border p-1 shadow-md"
        >
          <LocaleRadioList
            locale={locale}
            pending={pending}
            onChange={onChange}
            legend={t('label')}
            legendClassName="sr-only"
          />
        </div>
      ) : null}
    </div>
  );
}
