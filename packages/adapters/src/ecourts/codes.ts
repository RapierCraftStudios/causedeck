// eCourts code maps (#634): lookups built from the portal's own option lists, so no code is typed
// in by hand. `readEcourtsCodeMaps` reads the four drop-downs of the case-status search page.
import { compactCaseType } from '../normalise/case-type.ts';

import { parseOptionLists, type OptionEntry } from './options.ts';

export interface CodeMap {
  entries: readonly OptionEntry[];
  /** The printed label for a code, or null. */
  labelOf(code: string): string | null;
  /** The code for a label (case and spacing insensitive), or null. */
  codeOf(label: string): string | null;
}

const key = (label: string) => label.toLowerCase().replace(/\s+/g, ' ').trim();

export function createCodeMap(entries: readonly OptionEntry[]): CodeMap {
  const labels = new Map<string, string>();
  const codes = new Map<string, string>();
  for (const entry of entries) {
    if (!labels.has(entry.code)) labels.set(entry.code, entry.label);
    if (!codes.has(key(entry.label))) codes.set(key(entry.label), entry.code);
  }
  return {
    entries,
    labelOf: (code) => labels.get(code) ?? null,
    codeOf: (label) => codes.get(key(label)) ?? null,
  };
}

/** Drop-down ids on the eCourts case-status search page. */
export const ECOURTS_SELECT_IDS = {
  state: 'sess_state_code',
  district: 'sess_dist_code',
  establishment: 'court_complex_code',
  caseType: 'case_type',
} as const;

export interface EcourtsCodeMaps {
  state: CodeMap;
  district: CodeMap;
  establishment: CodeMap;
  /** Case type code -> printed label; `normalisedType` gives the adapters' compact form. */
  caseType: CodeMap;
}

export function readEcourtsCodeMaps(html: string): EcourtsCodeMaps {
  const lists = parseOptionLists(html);
  const map = (id: string) => createCodeMap(lists[id] ?? []);
  return {
    state: map(ECOURTS_SELECT_IDS.state),
    district: map(ECOURTS_SELECT_IDS.district),
    establishment: map(ECOURTS_SELECT_IDS.establishment),
    caseType: map(ECOURTS_SELECT_IDS.caseType),
  };
}

/** A `Original Suit - OS` label gives its short form (`OS`), else the compact label. */
export function caseTypeShortForm(label: string): string {
  const tail = /[-–]\s*([A-Za-z.]{1,12})\s*$/.exec(label);
  return compactCaseType(tail?.[1] ?? label);
}
