// The quiet "because you usually carry this" chip (#74): shows which memory a line or a draft fact
// used. Muted text with an accessible name; it carries no colour that print or a theme could lose.
import { useTranslations } from 'next-intl';

export function MemoryCitation({ reason }: { reason: 'carryRule' }) {
  const t = useTranslations('memoryCitations');
  const text = t(reason);
  return (
    <span
      data-memory-citation
      role="note"
      aria-label={t('chipLabel', { reason: text })}
      className="text-muted-foreground border-border rounded-sm border px-1.5 py-0.5 font-sans text-xs print:hidden"
    >
      {text}
    </span>
  );
}
