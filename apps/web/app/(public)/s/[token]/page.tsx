import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

// Never cached: a revoked link stops resolving at once.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return {
    title: 'Case status',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

interface StatusPageProps {
  params: Promise<{ token: string }>;
}

const FONTS: Record<string, string> = {
  ta: "'Noto Sans Tamil', 'Latha', system-ui, sans-serif",
  kn: "'Noto Sans Kannada', 'Tunga', system-ui, sans-serif",
};

function firstIp(forwarded: string | null): string | null {
  return forwarded?.split(',')[0]?.trim() || null;
}

/**
 * `/s/<token>` (#88, ADR 0049). Public and read-only (GET only: no form, no action): the advocate's
 * headline, note, optional next date and a "prepared by" line. A dead link, a rate-limited viewer
 * and an unknown token get the same generic page, or a 404 while the legal-gated flag is off.
 */
export default async function StatusLinkPage({ params }: StatusPageProps) {
  const { token } = await params;
  const h = await headers();
  const { db } = await import('@causedeck/core/runtime');
  const { resolveStatusLink } = await import('@causedeck/core/status-links');
  const result = await resolveStatusLink(
    { db },
    {
      token,
      ip: firstIp(h.get('x-forwarded-for')) ?? h.get('x-real-ip'),
      userAgent: h.get('user-agent'),
    },
  );
  if (result.state === 'not_found') notFound();
  const t = await getTranslations('statusLink');

  if (result.state !== 'ok') {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">{t('page.unavailable')}</h1>
        <p className="text-muted-foreground mt-2">{t('page.unavailableBody')}</p>
      </main>
    );
  }

  const { view } = result;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(view.language, { dateStyle: 'long', timeZone: 'Asia/Kolkata' }).format(
      new Date(iso),
    );
  return (
    <main
      lang={view.language}
      className="mx-auto max-w-xl space-y-4 p-6"
      style={FONTS[view.language] ? { fontFamily: FONTS[view.language] } : undefined}
    >
      <h1 className="text-xl font-semibold">{view.headline}</h1>
      <p className="whitespace-pre-line">{view.note}</p>
      {view.nextDate !== null && <p>{t('page.nextDate', { date: date(view.nextDate) })}</p>}
      <p className="text-muted-foreground text-sm">
        {view.advocateName === null
          ? t('page.preparedByUnknown')
          : t('page.preparedBy', { name: view.advocateName })}
      </p>
      <footer className="text-muted-foreground border-t pt-3 text-sm">
        {t('page.expires', { date: date(view.expiresAt) })}
      </footer>
    </main>
  );
}
