// Official-portal links for a citation. Links only: the app never fetches, frames or scrapes a court
// page. These are portal landing pages; the lawyer opens one in a new window and searches there.
import type { CitationKind } from '@causedeck/validators/citation';

export interface OfficialLink {
  label: string;
  url: string;
}

const PORTALS: Readonly<Record<string, OfficialLink>> = {
  INSC: { label: 'Supreme Court of India judgments', url: 'https://www.sci.gov.in/judgements/' },
  MHC: { label: 'Madras High Court judgments', url: 'https://www.mhc.tn.gov.in/judis/' },
  KHC: {
    label: 'Karnataka High Court judgments',
    url: 'https://karnatakajudiciary.kar.nic.in/',
  },
};

/** The portal for a neutral citation; null for a reporter citation or a name, which has none. */
export function officialLink(normalized: string, kind: CitationKind): OfficialLink | null {
  if (kind !== 'neutral') return null;
  if (/^\d{4} INSC \d+$/.test(normalized)) return PORTALS.INSC ?? null;
  const code = normalized.split(':')[1]?.split('-')[0];
  return code === undefined ? null : (PORTALS[code] ?? null);
}
