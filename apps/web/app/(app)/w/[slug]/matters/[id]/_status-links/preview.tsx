// The exact preview (#88): the same fields and order as the public page `/s/[token]`, so what the
// advocate sees here is what the client sees. Pure: no fetch, no state.
import { formatDate } from '@causedeck/i18n';
import { useTranslations } from 'next-intl';

const FONTS: Record<string, string> = {
  ta: "'Noto Sans Tamil', 'Latha', system-ui, sans-serif",
  kn: "'Noto Sans Kannada', 'Tunga', system-ui, sans-serif",
};

export interface StatusLinkPreviewProps {
  headline: string;
  note: string;
  /** ISO date, or null when the advocate did not include it. */
  nextDate: string | null;
  language: 'en' | 'ta' | 'kn';
  advocateName: string | null;
  /** ISO timestamp of the expiry. */
  expiresAt: string;
}

export function StatusLinkPreview(props: StatusLinkPreviewProps) {
  const t = useTranslations('statusLink');
  const date = (iso: string) => formatDate(iso, { locale: props.language });
  return (
    <section
      lang={props.language}
      aria-label={t('sheet.preview')}
      data-status-link-preview
      className="space-y-3 rounded-md border p-4"
      style={FONTS[props.language] ? { fontFamily: FONTS[props.language] } : undefined}
    >
      <h3 className="text-lg font-semibold">{props.headline}</h3>
      <p className="whitespace-pre-line">{props.note}</p>
      {props.nextDate === null ? null : <p>{t('page.nextDate', { date: date(props.nextDate) })}</p>}
      <p className="text-muted-foreground text-sm">
        {props.advocateName === null
          ? t('page.preparedByUnknown')
          : t('page.preparedBy', { name: props.advocateName })}
      </p>
      <p className="text-muted-foreground border-t pt-2 text-sm">
        {t('page.expires', { date: date(props.expiresAt) })}
      </p>
    </section>
  );
}
