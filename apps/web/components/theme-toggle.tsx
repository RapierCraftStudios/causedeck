'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

export const THEMES = ['light', 'dark', 'system'] as const;

export type ThemeChoice = (typeof THEMES)[number];

export const THEME_COOKIE = 'theme';

const ICONS = { light: Sun, dark: Moon, system: Monitor } satisfies Record<ThemeChoice, unknown>;

function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

const noopSubscribe = () => () => {};

/** next-themes persists to localStorage; the cookie lets the server see the choice too. */
export function persistThemeCookie(theme: ThemeChoice): void {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

/** Light / dark / system segmented control. No keyboard shortcut is bound here. */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  // The stored theme is only known on the client; render "system" until hydrated to match SSR.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const value = mounted && isThemeChoice(theme) ? theme : 'system';

  // Native buttons rather than the Radix toggle group: this sits on the home route, which has a
  // 180 KB initial-JS budget.
  return (
    <div
      role="group"
      aria-label={t('label')}
      data-slot="theme-toggle"
      className="border-line bg-surface-sunken inline-flex items-center gap-0.5 rounded-lg border p-0.5"
    >
      {THEMES.map((choice) => {
        const Icon = ICONS[choice];
        const pressed = value === choice;
        return (
          <button
            key={choice}
            type="button"
            aria-pressed={pressed}
            data-theme-choice={choice}
            onClick={() => {
              setTheme(choice);
              persistThemeCookie(choice);
            }}
            className={[
              'focus-visible:outline-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium outline-offset-2 focus-visible:outline-2 [&_svg]:size-4',
              pressed ? 'bg-surface-raised text-ink shadow-1' : 'text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            <Icon aria-hidden="true" />
            {t(choice)}
          </button>
        );
      })}
    </div>
  );
}
