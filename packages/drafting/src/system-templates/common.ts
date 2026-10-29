// Shared builders for the system templates (#76). A template is data: a block tree of fixed text,
// slots filled from the matter facts, and narrative blocks the lawyer writes. Court nomenclature
// (case-type labels) is read from the adapters' catalogue, never typed here. Nothing in a template
// is advice, a commitment, a fee quote or a citation; the lints in the test suite enforce that.
import { createHash } from 'node:crypto';

import { caseTypeInfo, karnatakaCaseTypeInfo } from '@causedeck/adapters';
import type { Block, CourtPreset, SystemTemplateSeed } from '@causedeck/validators/drafting';

export const FIRST_RELEASE = '1.0.0';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface TemplateDefinition {
  code: string;
  name: string;
  kind: 'memo' | 'other';
  courtPreset: CourtPreset;
  semver?: string;
  blocks: Block[];
}

/** A seed row with its checksum; `reviewedBy` stays null until an advocate signs the wording off. */
export function defineTemplate(def: TemplateDefinition): SystemTemplateSeed {
  const body = {
    code: def.code,
    name: def.name,
    kind: def.kind,
    courtPreset: def.courtPreset,
    locale: 'en' as const,
    semver: def.semver ?? FIRST_RELEASE,
    blocks: def.blocks,
  };
  return {
    ...body,
    checksum: createHash('sha256').update(canonical(body)).digest('hex'),
    reviewedBy: null,
  };
}

const labelsOf = (
  codes: readonly string[],
  lookup: (code: string) => { label: string } | undefined,
  court: string,
): string[] =>
  codes.map((code) => {
    const info = lookup(code);
    if (info === undefined) throw new Error(`${court} case-type catalogue has no ${code}`);
    return info.label;
  });

/** Case-type labels as the Madras HC adapter catalogue prints them. */
export const madrasCaseTypes = (...codes: string[]): string =>
  labelsOf(codes, caseTypeInfo, 'Madras HC').join(', ');

/** Case-type labels as the Karnataka HC adapter catalogue prints them. */
export const karnatakaCaseTypes = (...codes: string[]): string =>
  labelsOf(codes, karnatakaCaseTypeInfo, 'Karnataka HC').join(', ');

const slot = (resolver: Extract<Block, { type: 'slot' }>['resolver'], label: string): Block => ({
  type: 'slot',
  resolver,
  label,
});
const p = (text: string): Block => ({ type: 'paragraph', text });

/** Court, matter type, number, parties, bench and listing date, then the matter title. */
export function caption(caseTypes: string, numberLabel: string): Block[] {
  return [
    slot('matter.court', 'Court'),
    p(`Matter type: ${caseTypes}`),
    slot('matter.cnr', numberLabel),
    slot('matter.title', 'Matter'),
    slot('party.petitioner', 'Petitioner'),
    slot('party.respondent', 'Respondent'),
    slot('hearing.bench', 'Before'),
    slot('hearing.next_date', 'Listed on'),
  ];
}

export const narrative = (prompt: string, maxChars = 1500): Block => ({
  type: 'narrative',
  prompt: `${prompt} Use only the facts supplied. Give no advice, no commitment, no fee and no citation.`,
  maxChars,
});

/** Closing block: the advocate who signs, and the date. */
export const signOff = (): Block[] => [
  slot('advocate.name', 'Advocate'),
  slot('advocate.enrolment_no', 'Enrolment No.'),
  slot('date.today', 'Date'),
];

export const heading = (text: string): Block => ({ type: 'heading', level: 1, text });
export const section = (title: string, ...children: Block[]): Block => ({
  type: 'section',
  title,
  children,
});
export const text = p;
export const field = slot;

/** A letter to an existing client of the workspace: the only recipient slot is `client.name`. */
export function clientLetter(code: string, name: string, preset: CourtPreset): SystemTemplateSeed {
  return defineTemplate({
    code,
    name,
    kind: 'other',
    courtPreset: preset,
    blocks: [
      slot('workspace.name', 'From'),
      slot('date.today', 'Date'),
      slot('client.name', 'To'),
      slot('matter.title', 'Re'),
      p('Dear Sir or Madam,'),
      narrative(
        'Write two or three sentences stating which documents are enclosed with this letter and why they are being sent.',
        1200,
      ),
      p('Please contact the office if any enclosure is unclear.'),
      slot('advocate.name', 'Yours faithfully'),
    ],
  });
}

/** A letter to junior or senior counsel: the only recipient slot is `counsel.name`, never a client or party. */
export function counselLetter(code: string, name: string, preset: CourtPreset): SystemTemplateSeed {
  return defineTemplate({
    code,
    name,
    kind: 'other',
    courtPreset: preset,
    blocks: [
      slot('workspace.name', 'From'),
      slot('date.today', 'Date'),
      slot('counsel.name', 'To'),
      slot('matter.title', 'Re'),
      p('Dear Sir or Madam,'),
      narrative(
        'Write two or three sentences stating which documents are enclosed with this letter and what the receiving counsel is asked to look at.',
        1200,
      ),
      p('Please contact the office if any enclosure is unclear.'),
      slot('advocate.name', 'Yours faithfully'),
    ],
  });
}
