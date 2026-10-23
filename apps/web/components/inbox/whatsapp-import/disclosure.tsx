'use client';
// The per-channel disclosure (#527): what happens to a WhatsApp chat, shown before any file is chosen.
import { useTranslations } from 'next-intl';

const KEYS = ['parsed', 'selected', 'held', 'voice', 'access', 'retention'] as const;

export function WhatsAppDisclosure() {
  const t = useTranslations('whatsappImport.disclosure');
  return (
    <section
      aria-labelledby="whatsapp-disclosure"
      data-slot="whatsapp-disclosure"
      className="bg-surface-raised border-line grid gap-2 rounded-xl border p-4"
    >
      <h2 id="whatsapp-disclosure" className="text-ink text-sm font-medium">
        {t('title')}
      </h2>
      <ul className="text-ink-muted grid list-disc gap-1 ps-5 text-sm">
        {KEYS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
    </section>
  );
}
