'use client';
import type { ProvenanceLabels } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';

/** The chip popover labels the sheet overrides: 'Open page' and the page and confidence texts. */
export function useProvenanceLabels(): Partial<ProvenanceLabels> {
  const t = useTranslations('brief.provenance');
  const line = useTranslations('brief.line');
  return {
    openSource: t('openPage'),
    page: (page) => line('page', { page }),
    confidence: (percent) => t('confidence', { value: `${String(percent)}%` }),
  };
}
