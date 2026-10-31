// The criminal-code correspondence (#894, ADR 0051 §Enrichment): the 1 July 2024 codes replaced the
// Indian Penal Code, the Code of Criminal Procedure and the Indian Evidence Act with the Bharatiya
// Nyaya Sanhita (BNS), the Bharatiya Nagarik Suraksha Sanhita (BNSS) and the Bharatiya Sakshya
// Adhiniyam (BSA). A judgment on a 2022 offence cites IPC 304A while a lawyer searches BNS 106, so a
// facet search expands to both. The table is data with a version and a source note; a change to any
// row bumps `CODE_MAP_VERSION` and `ENRICH_VERSION` so the facets are rebuilt.
import { normaliseSection } from '../../issues/index.ts';

export const CODE_MAP_VERSION = 1;

/**
 * Source: the correspondence tables the Bureau of Police Research and Development (BPR&D, Ministry of
 * Home Affairs) published for BNS/IPC, BNSS/CrPC and BSA/IEA. This file carries the sections that
 * recur in judgments, not every row; add rows from the tables, never from memory.
 */
export const CODE_MAP_SOURCE =
  'BPR&D correspondence tables for BNS/IPC, BNSS/CrPC and BSA/IEA (Ministry of Home Affairs, 2024)';

/** The day the new codes came into force: an offence on or after it falls under the new code. */
export const NEW_CODES_IN_FORCE = '2024-07-01';

export const IPC = 'indian penal code';
export const BNS = 'bharatiya nyaya sanhita';
export const CRPC = 'code of criminal procedure';
export const BNSS = 'bharatiya nagarik suraksha sanhita';
export const IEA = 'indian evidence act';
export const BSA = 'bharatiya sakshya adhiniyam';

/** `[old statute, old section, new statute, new section]`; sections as `normaliseSection` writes them. */
export const CODE_MAP: readonly (readonly [string, string, string, string])[] = [
  [IPC, '34', BNS, '3'],
  [IPC, '120b', BNS, '61'],
  [IPC, '299', BNS, '100'],
  [IPC, '300', BNS, '101'],
  [IPC, '302', BNS, '103'],
  [IPC, '304', BNS, '105'],
  [IPC, '304a', BNS, '106'],
  [IPC, '304b', BNS, '80'],
  [IPC, '306', BNS, '108'],
  [IPC, '307', BNS, '109'],
  [IPC, '323', BNS, '115'],
  [IPC, '324', BNS, '118'],
  [IPC, '354', BNS, '74'],
  [IPC, '376', BNS, '64'],
  [IPC, '379', BNS, '303'],
  [IPC, '392', BNS, '309'],
  [IPC, '406', BNS, '316'],
  [IPC, '420', BNS, '318'],
  [IPC, '498a', BNS, '85'],
  [IPC, '499', BNS, '356'],
  [IPC, '509', BNS, '79'],
  [CRPC, '125', BNSS, '144'],
  [CRPC, '154', BNSS, '173'],
  [CRPC, '161', BNSS, '180'],
  [CRPC, '164', BNSS, '183'],
  [CRPC, '173', BNSS, '193'],
  [CRPC, '313', BNSS, '351'],
  [CRPC, '374', BNSS, '415'],
  [CRPC, '389', BNSS, '430'],
  [CRPC, '397', BNSS, '438'],
  [CRPC, '437', BNSS, '480'],
  [CRPC, '438', BNSS, '482'],
  [CRPC, '439', BNSS, '483'],
  [CRPC, '482', BNSS, '528'],
  [IEA, '3', BSA, '2'],
  [IEA, '24', BSA, '22'],
  [IEA, '25', BSA, '23'],
  [IEA, '45', BSA, '39'],
  [IEA, '65b', BSA, '63'],
  [IEA, '101', BSA, '104'],
  [IEA, '106', BSA, '109'],
  [IEA, '114', BSA, '119'],
];

export interface StatuteSection {
  statute: string;
  section: string;
}

/** `106(1)` is `106`: the correspondence is by section, not sub-clause. */
export function baseSection(section: string): string {
  const key = normaliseSection(section);
  const open = key.indexOf('(');
  return open === -1 ? key : key.slice(0, open);
}

/** The code a given date's offences fall under: the old code before the new ones came into force. */
export function codeInForce(offenceDate: string): 'old' | 'new' {
  return offenceDate >= NEW_CODES_IN_FORCE ? 'new' : 'old';
}

export interface Equivalent extends StatuteSection {
  /** Whether the counterpart's code governs an offence on `offenceDate`; null when no date is known. */
  inForce: boolean | null;
}

/** The counterpart sections of `ref` in the other code, with whether each governs an offence on `offenceDate`. */
export function equivalents(ref: StatuteSection, offenceDate?: string | null): Equivalent[] {
  const section = baseSection(ref.section);
  const out: Equivalent[] = [];
  for (const [oldStatute, oldSection, newStatute, newSection] of CODE_MAP) {
    const isOld = ref.statute === oldStatute && section === oldSection;
    const isNew = ref.statute === newStatute && section === newSection;
    if (!isOld && !isNew) continue;
    const counterpart = isOld
      ? { statute: newStatute, section: newSection }
      : { statute: oldStatute, section: oldSection };
    out.push({
      ...counterpart,
      inForce: offenceDate == null ? null : codeInForce(offenceDate) === (isOld ? 'new' : 'old'),
    });
  }
  return out;
}

/** The statute and section keys a facet search for `ref` must match: itself and its counterparts. */
export function facetKeys(ref: StatuteSection): StatuteSection[] {
  const keys = new Map<string, StatuteSection>();
  const base = { statute: ref.statute, section: baseSection(ref.section) };
  keys.set(`${base.statute}|${base.section}`, base);
  for (const e of equivalents(ref)) {
    keys.set(`${e.statute}|${e.section}`, { statute: e.statute, section: e.section });
  }
  return [...keys.values()];
}

/** True when a stored `section` (`11(6)`) is the facet's base section or a sub-clause of it. */
export function sectionWithin(stored: string, base: string): boolean {
  const key = normaliseSection(stored);
  return key === base || key.startsWith(`${base}(`);
}
