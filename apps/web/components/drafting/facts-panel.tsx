'use client';

// The studio's Facts panel (#827): each fact the draft's slots resolved to, as a Provenance Chip
// with an insert button. Inserting puts the value into the selected slot (or after it).
import { ProvenanceChip, type ProvenanceSource } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';

export interface DraftFact {
  id: string;
  label: string;
  value: string;
  source: ProvenanceSource;
}

export interface FactsPanelProps {
  facts: readonly DraftFact[];
  /** Block key of the focused slot; inserting is off without one. */
  selectedSlot?: string | undefined;
  disabled?: boolean;
  onInsert: (fact: DraftFact) => void;
}

export function FactsPanel({ facts, selectedSlot, disabled = false, onInsert }: FactsPanelProps) {
  const t = useTranslations('drafting.panels.facts');
  return (
    <section
      data-slot="facts-panel"
      aria-labelledby="facts-panel-title"
      className="flex flex-col gap-3"
    >
      <h2 id="facts-panel-title" className="text-sm font-semibold">
        {t('title')}
      </h2>
      {facts.length === 0 ? <p className="text-ink-muted text-sm">{t('empty')}</p> : null}
      {facts.length > 0 && selectedSlot === undefined ? (
        <p className="text-ink-muted text-sm">{t('selectSlot')}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {facts.map((fact) => (
          <li key={fact.id} className="border-line flex flex-col gap-1 rounded-md border p-2">
            <span className="text-ink-muted text-xs">{fact.label}</span>
            <span className="font-serif">{fact.value}</span>
            <div className="flex items-center gap-2">
              <ProvenanceChip source={fact.source} viewOnly />
              <button
                type="button"
                disabled={disabled || selectedSlot === undefined}
                aria-label={t('insert', { label: fact.label })}
                onClick={() => {
                  onInsert(fact);
                }}
                className="border-line focus-visible:ring-focus min-h-11 rounded-md border px-3 text-sm focus-visible:ring-2 disabled:opacity-50"
              >
                +
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
