'use client';

// The studio's Pinned authorities panel (#782): the authorities the lawyer pinned on the matter's
// research notes, each with an insert button. Inserting puts the citation string (or the label when
// there is none) into the selected block; the saved version is then labelled by the citation check.
import { useTranslations } from 'next-intl';

export interface PinnedAuthority {
  id: string;
  label: string;
  citation?: string | undefined;
}

export interface AuthoritiesPanelProps {
  authorities: readonly PinnedAuthority[];
  /** Block key of the selected block; inserting is off without one. */
  selectedSlot?: string | undefined;
  disabled?: boolean;
  /** `text` is what goes into the block: the citation string, or the label without one. */
  onInsert: (text: string, authority: PinnedAuthority) => void;
}

/** The text an authority puts into a draft block. */
export const authorityText = (authority: PinnedAuthority): string =>
  authority.citation !== undefined && authority.citation.trim() !== ''
    ? authority.citation
    : authority.label;

export function AuthoritiesPanel({
  authorities,
  selectedSlot,
  disabled = false,
  onInsert,
}: AuthoritiesPanelProps) {
  const t = useTranslations('drafting.panels.authorities');
  return (
    <section
      data-slot="authorities-panel"
      aria-labelledby="authorities-panel-title"
      className="flex flex-col gap-3"
    >
      <h2 id="authorities-panel-title" className="text-sm font-semibold">
        {t('title')}
      </h2>
      {authorities.length === 0 ? <p className="text-ink-muted text-sm">{t('empty')}</p> : null}
      {authorities.length > 0 && selectedSlot === undefined ? (
        <p className="text-ink-muted text-sm">{t('selectBlock')}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {authorities.map((authority) => (
          <li key={authority.id} className="border-line flex flex-col gap-1 rounded-md border p-2">
            <span className="text-ink-muted text-xs">{authority.label}</span>
            <span className="font-serif">{authorityText(authority)}</span>
            {authority.citation === undefined || authority.citation.trim() === '' ? (
              <span className="text-ink-muted text-xs">{t('noCitation')}</span>
            ) : null}
            <button
              type="button"
              disabled={disabled || selectedSlot === undefined}
              aria-label={t('insert', { label: authority.label })}
              onClick={() => {
                onInsert(authorityText(authority), authority);
              }}
              className="border-line focus-visible:ring-focus min-h-11 self-start rounded-md border px-3 text-sm focus-visible:ring-2 disabled:opacity-50"
            >
              +
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
