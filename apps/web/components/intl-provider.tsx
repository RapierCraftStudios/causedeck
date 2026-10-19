'use client';

// `NextIntlClientProvider` with the #174 missing-key behaviour on the client. Functions cannot
// cross the server/client boundary, so the root layout passes data and this sets the handlers.
// No catalog is imported here: the layout hands over the active locale's messages only.
import {
  createMissingKeyHandlers,
  type Messages,
  type MissingKeyMode,
} from '@causedeck/i18n/client';
import type { Locale } from '@causedeck/i18n/locales';
import { NextIntlClientProvider } from 'next-intl';
import { useMemo, type ReactNode } from 'react';

export function IntlProvider({
  locale,
  messages,
  timeZone,
  mode,
  children,
}: {
  locale: Locale;
  messages: Messages;
  timeZone: string;
  /** From the server (`isProd()` in lib/env.ts, the one module that reads the environment). */
  mode: MissingKeyMode;
  children: ReactNode;
}) {
  const handlers = useMemo(
    () =>
      createMissingKeyHandlers({
        mode,
        // Server loading already filled ta/kn gaps with English; anything left is a bug to surface.
        report: (info) => {
          console.error('[i18n]', info.code, info.message);
        },
      }),
    [mode],
  );
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
      onError={handlers.onError}
      getMessageFallback={handlers.getMessageFallback}
    >
      {children}
    </NextIntlClientProvider>
  );
}
