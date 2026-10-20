// The account shell (#289, #25 design spec). `/account` is the signed-in user's own settings, not
// workspace-scoped: the `Account` header, a sub-nav (Profile, Security) and the content column,
// with the settings offline banner on top (settings are read-only offline).
// - 360: one column; the sub-nav is a row of links under the header; no horizontal scroll.
// - 768: a 200 px sticky sub-nav at the left and a content column of at most 560 px.
// - 1280+: a 220 px sub-nav and a 640 px content column.
// The `(app)` layout already sends anyone without a session to `/sign-in`.
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { SettingsOfflineBanner } from '../../../components/settings/settings-offline-banner.tsx';

const SECTIONS = ['profile', 'security'] as const;

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('settings.account');
  return (
    <main
      id="main"
      tabIndex={-1}
      data-slot="account-shell"
      className="mx-auto flex w-full max-w-[1200px] min-w-0 flex-col gap-4 px-4 py-6 outline-none md:px-6 md:py-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
        <p className="text-ink-muted text-sm">{t('description')}</p>
      </header>
      <div className="flex min-w-0 flex-col gap-6 md:grid md:grid-cols-[200px_minmax(0,560px)] md:items-start md:gap-8 xl:grid-cols-[220px_minmax(0,640px)]">
        <nav aria-label={t('navLabel')} className="md:sticky md:top-4">
          <ul className="flex gap-1 md:flex-col">
            {SECTIONS.map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="text-ink hover:bg-surface-sunken focus-visible:outline-ring block rounded-md px-3 py-2 text-sm focus-visible:outline-2"
                >
                  {t(`nav.${id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div data-slot="account-content" className="flex min-w-0 flex-col gap-4">
          <SettingsOfflineBanner />
          {children}
        </div>
      </div>
    </main>
  );
}
