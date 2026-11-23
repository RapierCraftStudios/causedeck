// The demo statute layer (#1123, part 1 of #1116): four acts, one section each, and the section
// versions, global rows written by the owner role (`seedDemoCatalogue`). IPC 304A and BNS 106 are the
// CODE_MAP pair the statute pages show side by side (IPC 304A with two versions, so the history view
// has data); CrPC 439 and BNSS 483 are the pair the demo corpus cites (the bail judgments, corpus.ts),
// so a section's top authorities resolve to demo judgments.
//
// - No editorial content (D-001 amended, ADR 0051): every version text is a short synthetic paraphrase
//   written for the demo, marked `synthetic` with a source note; never SCC or any annotated source. The
//   act rows are public facts (title, year, commencement), marked not synthetic with a source note.
// - Keys mirror `normaliseStatute` / `normaliseSection` of `@causedeck/intelligence` and the constants
//   of its `code-map.ts` (`@causedeck/db` cannot import it); core's demo content test pins them.
// - Deterministic: fixed ids, so `onConflictDoNothing` makes a second run a no-op.
import type { statuteAct, statuteSection, statuteSectionVersion } from '../../schema/statutes.ts';

import { demoId } from './shared.ts';

export type DemoStatuteActRow = typeof statuteAct.$inferInsert & { id: string };
export type DemoStatuteSectionRow = typeof statuteSection.$inferInsert & { id: string };
export type DemoStatuteVersionRow = typeof statuteSectionVersion.$inferInsert & { id: string };

export interface DemoStatuteRows {
  acts: DemoStatuteActRow[];
  sections: DemoStatuteSectionRow[];
  versions: DemoStatuteVersionRow[];
}

/** Row kinds of the statute ids (free in `ID_KIND` of shared.ts). */
const KIND = { act: 0xf3, section: 0xf4, version: 0xf5 } as const;

/** `normaliseStatute` keys (the IPC, BNS, CRPC and BNSS constants of `code-map.ts`). */
export const DEMO_STATUTE_KEYS = {
  ipc: 'indian penal code',
  bns: 'bharatiya nyaya sanhita',
  crpc: 'code of criminal procedure',
  bnss: 'bharatiya nagarik suraksha sanhita',
} as const;

/** The day the BNS and the BNSS replaced the IPC and the CrPC (`NEW_CODES_IN_FORCE`). */
const NEW_CODES_IN_FORCE = '2024-07-01';

const ACT_SOURCE =
  'Short title, year and commencement as published in the Gazette of India (public facts); no section text from this row.';
const SYNTHETIC_TEXT =
  'SYNTHETIC: a paraphrase written for the CauseDeck demo, not the bare-act wording and not taken from any reporter or commentary.';

const act = (n: number, row: Omit<DemoStatuteActRow, 'id' | 'sourceNote' | 'synthetic'>) => ({
  id: demoId(KIND.act, n),
  ...row,
  sourceNote: ACT_SOURCE,
  synthetic: false,
});

const ACTS: DemoStatuteActRow[] = [
  act(1, {
    key: DEMO_STATUTE_KEYS.ipc,
    title: 'The Indian Penal Code',
    shortName: 'IPC',
    year: 1860,
    inForceFrom: '1862-01-01',
  }),
  act(2, {
    key: DEMO_STATUTE_KEYS.bns,
    title: 'The Bharatiya Nyaya Sanhita',
    shortName: 'BNS',
    year: 2023,
    inForceFrom: NEW_CODES_IN_FORCE,
  }),
  act(3, {
    key: DEMO_STATUTE_KEYS.crpc,
    title: 'The Code of Criminal Procedure',
    shortName: 'CrPC',
    year: 1973,
    inForceFrom: '1974-04-01',
  }),
  act(4, {
    key: DEMO_STATUTE_KEYS.bnss,
    title: 'The Bharatiya Nagarik Suraksha Sanhita',
    shortName: 'BNSS',
    year: 2023,
    inForceFrom: NEW_CODES_IN_FORCE,
  }),
];

const actId = (key: string): string => {
  const found = ACTS.find((a) => a.key === key);
  if (found === undefined) throw new Error(`demo statute: unknown act ${key}`);
  return found.id;
};

const SECTIONS: DemoStatuteSectionRow[] = [
  {
    id: demoId(KIND.section, 1),
    actId: actId(DEMO_STATUTE_KEYS.ipc),
    section: '304a',
    heading: 'Causing death by negligence',
  },
  {
    id: demoId(KIND.section, 2),
    actId: actId(DEMO_STATUTE_KEYS.bns),
    section: '106',
    heading: 'Causing death by negligence',
  },
  {
    id: demoId(KIND.section, 3),
    actId: actId(DEMO_STATUTE_KEYS.crpc),
    section: '439',
    heading: 'Special powers of High Court or Court of Session regarding bail',
  },
  {
    id: demoId(KIND.section, 4),
    actId: actId(DEMO_STATUTE_KEYS.bnss),
    section: '483',
    heading: 'Special powers of High Court or Court of Session regarding bail',
  },
];

const section = (n: number): string => SECTIONS[n - 1]?.id ?? '';

const version = (
  n: number,
  row: Omit<DemoStatuteVersionRow, 'id' | 'sourceNote' | 'synthetic'>,
): DemoStatuteVersionRow => ({
  id: demoId(KIND.version, n),
  amendedBy: null,
  ...row,
  sourceNote: SYNTHETIC_TEXT,
  synthetic: true,
});

const VERSIONS: DemoStatuteVersionRow[] = [
  // Two versions of IPC 304A: the split is illustrative demo history, not the legislative record.
  version(1, {
    sectionId: section(1),
    text: 'SYNTHETIC. A person who causes the death of another by a rash or careless act that does not amount to culpable homicide may be imprisoned for a limited term, fined, or both.',
    validFrom: '1870-01-01',
    validTo: '1956-01-01',
  }),
  version(2, {
    sectionId: section(1),
    text: 'SYNTHETIC. Whoever causes the death of a person by a rash or negligent act not amounting to culpable homicide is liable to imprisonment of either description for up to two years, or a fine, or both.',
    validFrom: '1956-01-01',
    validTo: NEW_CODES_IN_FORCE,
    amendedBy: 'Illustrative demo amendment (fictional)',
  }),
  version(3, {
    sectionId: section(2),
    text: 'SYNTHETIC. Whoever causes the death of a person by a rash or negligent act not amounting to culpable homicide is liable to imprisonment for up to five years and a fine; a registered medical practitioner acting in a procedure faces up to two years and a fine.',
    validFrom: NEW_CODES_IN_FORCE,
    validTo: null,
  }),
  version(4, {
    sectionId: section(3),
    text: 'SYNTHETIC. The High Court or the Court of Session may direct that a person accused of an offence and in custody be released on bail, impose conditions it considers necessary, and set aside or modify conditions imposed by a Magistrate.',
    validFrom: '1974-04-01',
    validTo: NEW_CODES_IN_FORCE,
  }),
  version(5, {
    sectionId: section(4),
    text: 'SYNTHETIC. The High Court or the Court of Session may direct that a person accused of an offence and in custody be released on bail, impose conditions it considers necessary, and set aside or modify conditions imposed by a Magistrate.',
    validFrom: NEW_CODES_IN_FORCE,
    validTo: null,
  }),
];

/** The demo statute rows (fresh copies). */
export function demoStatuteRows(): DemoStatuteRows {
  return {
    acts: ACTS.map((a) => ({ ...a })),
    sections: SECTIONS.map((s) => ({ ...s })),
    versions: VERSIONS.map((v) => ({ ...v })),
  };
}
