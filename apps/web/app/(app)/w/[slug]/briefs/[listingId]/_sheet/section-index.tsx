'use client';
// The section-jump chip row (#61, R8): on a narrow screen it replaces the side rail. Each chip is a
// link to its section, so it works without a pointer.
import { useTranslations } from 'next-intl';

import { sectionDomId, type SectionKey } from './model.ts';

const LABEL_KEY: Record<SectionKey, string> = {
  stage: 'stage',
  last_order: 'lastOrder',
  obligations: 'obligations',
  carry: 'carry',
  synopsis: 'synopsis',
  last_hearing: 'lastHearing',
  court_notes: 'courtNotes',
  context: 'context',
};

export const sectionLabelKey = (key: SectionKey) => LABEL_KEY[key];

export function SectionIndex({ sections }: { sections: readonly SectionKey[] }) {
  const t = useTranslations('brief');
  return (
    <nav aria-label={t('actions.jump')} className="flex gap-2 overflow-x-auto font-sans text-sm print:hidden">
      {sections.map((key, index) => (
        <a
          key={key}
          href={`#${sectionDomId(key)}`}
          className="border-border focus-visible:outline-ring shrink-0 rounded-full border px-3 py-1 outline-offset-2 focus-visible:outline-2"
        >
          <span className="text-muted-foreground tabular-nums">{String(index + 1)} </span>
          {t(`sections.${LABEL_KEY[key]}`)}
        </a>
      ))}
    </nav>
  );
}
