// Column auto-mapping for the spreadsheet importer (#504): which header is the case number, the
// court, the next date, the party and the stage. Headers are normalised (case, punctuation, spaces)
// and matched against synonyms: exact first, then a header that contains a synonym. A mapping is
// by header text, so a chamber's saved mapping survives a re-ordered sheet; it overrides the guess.

export const IMPORT_FIELDS = [
  'caseNumber',
  'caseType',
  'cnr',
  'court',
  'nextDate',
  'party',
  'stage',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Field -> header text. Serialisable: this is what a chamber saves. */
export type ColumnMapping = Partial<Record<ImportField, string>>;
/** Field -> 0-based column. */
export type ColumnIndices = Partial<Record<ImportField, number>>;

const RAW_SYNONYMS: Record<ImportField, readonly string[]> = {
  cnr: ['cnr', 'cnrno', 'cnrnumber'],
  caseNumber: [
    'caseno',
    'casenumber',
    'matterno',
    'matternumber',
    'suitno',
    'fileno',
    'filenumber',
    'number',
    'no',
    'caseref',
    'reference',
    'ref',
  ],
  caseType: ['casetype', 'type', 'mattertype', 'category', 'nature', 'natureofcase'],
  court: [
    'court',
    'courtname',
    'forum',
    'bench',
    'tribunal',
    'courtforum',
    'courtbench',
    'jurisdiction',
  ],
  nextDate: [
    'nextdate',
    'nextdateofhearing',
    'nexthearing',
    'nexthearingdate',
    'nextlisting',
    'nextlistingdate',
    'datenext',
    'hearingdate',
    'nextdt',
    'listedon',
    'listingdate',
    'dateofnexthearing',
    'nextdue',
    'next',
    'date',
  ],
  party: [
    'party',
    'parties',
    'partyname',
    'partynames',
    'title',
    'casetitle',
    'client',
    'clientname',
    'versus',
    'petitioner',
    'causetitle',
    'matter',
    'mattername',
    'vs',
  ],
  stage: [
    'stage',
    'status',
    'casestage',
    'casestatus',
    'purpose',
    'stageofcase',
    'purposeofhearing',
    'posting',
  ],
};

const SYNONYMS: Record<ImportField, readonly string[]> = {
  caseNumber: RAW_SYNONYMS.caseNumber.map(norm),
  caseType: RAW_SYNONYMS.caseType.map(norm),
  cnr: RAW_SYNONYMS.cnr.map(norm),
  court: RAW_SYNONYMS.court.map(norm),
  nextDate: RAW_SYNONYMS.nextDate.map(norm),
  party: RAW_SYNONYMS.party.map(norm),
  stage: RAW_SYNONYMS.stage.map(norm),
};

function norm(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Specific fields first so "Case Type" is not taken as the number, "CNR" not as a case number. */
const ORDER: readonly ImportField[] = [
  'cnr',
  'nextDate',
  'caseType',
  'caseNumber',
  'court',
  'stage',
  'party',
];

export interface AutoMapResult {
  /** The guess by header text (what a chamber would save). */
  mapping: ColumnMapping;
  indices: ColumnIndices;
  mappedCount: number;
  /** Mapped columns over non-empty headers, 0..1. */
  coverage: number;
  /** Non-empty headers no field took. */
  unmapped: string[];
}

/** Resolve a saved mapping against a header row: a header that is gone is ignored. */
export function applyMapping(header: readonly string[], mapping: ColumnMapping): ColumnIndices {
  const indices: ColumnIndices = {};
  const taken = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const wanted = mapping[field];
    if (wanted === undefined) continue;
    const index = header.findIndex((h, i) => !taken.has(i) && norm(h) === norm(wanted));
    if (index >= 0) {
      indices[field] = index;
      taken.add(index);
    }
  }
  return indices;
}

/** Guess the mapping of `header`; `saved` entries win over the guess. */
export function autoMapColumns(
  header: readonly string[],
  saved: ColumnMapping = {},
): AutoMapResult {
  const indices = applyMapping(header, saved);
  const taken = new Set<number>(Object.values(indices));
  const normalised = header.map(norm);
  const claim = (field: ImportField, match: (h: string) => boolean): void => {
    const index = normalised.findIndex((h, i) => h !== '' && !taken.has(i) && match(h));
    if (index >= 0) {
      indices[field] = index;
      taken.add(index);
    }
  };
  for (const pass of ['exact', 'contains'] as const) {
    for (const field of ORDER) {
      if (indices[field] !== undefined) continue;
      const words = SYNONYMS[field];
      if (pass === 'exact') claim(field, (h) => words.includes(h));
      else claim(field, (h) => words.some((w) => w.length >= 4 && h.includes(w)));
    }
  }
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const index = indices[field];
    if (index !== undefined) mapping[field] = (header[index] ?? '').trim();
  }
  const present = header.filter((h) => h.trim() !== '').length;
  const mappedCount = taken.size;
  return {
    mapping,
    indices,
    mappedCount,
    coverage: present === 0 ? 0 : mappedCount / present,
    unmapped: header.filter((h, i) => h.trim() !== '' && !taken.has(i)),
  };
}
