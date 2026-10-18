// Pattern story and test data. Courts are real; parties, orders and numbers are fictional.
import type { Anchor, ProvenanceSource, Proposal } from '../types';

export const MADRAS_MATTER = 'M/s Kaveri Textiles v. State of Tamil Nadu';
export const KARNATAKA_MATTER = 'Malnad Coffee Growers v. Karnataka Forest Department';

export const PARTIES = {
  madras: { petitioner: 'M/s Kaveri Textiles', respondent: 'State of Tamil Nadu' },
  karnataka: {
    petitioner: 'Malnad Coffee Growers',
    respondent: 'Karnataka Forest Department',
  },
} as const;

export const ORDERS = {
  madras: {
    court: 'High Court of Judicature at Madras',
    caseNumber: 'W.P. No. 1234 of 2026',
    title: 'Order dated 12 March 2026',
    date: '2026-03-12',
  },
  karnataka: {
    court: 'High Court of Karnataka at Bengaluru',
    caseNumber: 'W.P. No. 5678 of 2026 (GM-RES)',
    title: 'Order dated 3 April 2026',
    date: '2026-04-03',
  },
} as const;

const MADRAS_QUOTE =
  'List the matter on 14.11.2026. The respondents shall file their counter affidavit within four weeks.';
const KARNATAKA_QUOTE =
  'Office objections to be complied within two weeks, failing which the petition stands dismissed.';
const TAMIL_QUOTE = 'வழக்கை 14.11.2026 அன்று பட்டியலிடவும்.';
const KANNADA_QUOTE = 'ಕಚೇರಿ ಆಕ್ಷೇಪಣೆಗಳನ್ನು ಎರಡು ವಾರಗಳಲ್ಲಿ ಪಾಲಿಸಬೇಕು.';

const span = (quote: string, match: string): { start: number; end: number } => {
  const start = quote.indexOf(match);
  return { start, end: start + match.length };
};

export const ANCHORS = {
  madras: {
    id: 'anchor-madras-1',
    documentTitle: ORDERS.madras.title,
    quote: MADRAS_QUOTE,
    highlight: span(MADRAS_QUOTE, '14.11.2026'),
    page: 2,
    pageCount: 5,
  },
  karnataka: {
    id: 'anchor-karnataka-1',
    documentTitle: ORDERS.karnataka.title,
    quote: KARNATAKA_QUOTE,
    highlight: span(KARNATAKA_QUOTE, 'within two weeks'),
    page: 1,
    pageCount: 3,
  },
  tamil: {
    id: 'anchor-tamil-1',
    documentTitle: 'உத்தரவு, 12 மார்ச் 2026',
    quote: TAMIL_QUOTE,
    highlight: span(TAMIL_QUOTE, '14.11.2026'),
    page: 2,
    pageCount: 5,
  },
  kannada: {
    id: 'anchor-kannada-1',
    documentTitle: 'ಆದೇಶ, 3 ಏಪ್ರಿಲ್ 2026',
    quote: KANNADA_QUOTE,
    highlight: span(KANNADA_QUOTE, 'ಎರಡು ವಾರಗಳಲ್ಲಿ'),
    page: 1,
    pageCount: 3,
  },
} satisfies Record<string, Anchor>;

/** One source per kind and state the chip has to render. */
export const SOURCES = {
  confirmed: {
    kind: 'document',
    label: 'Order, p.2',
    quote: MADRAS_QUOTE,
    page: 2,
    anchorId: ANCHORS.madras.id,
    confidence: 0.97,
    state: 'confirmed',
  },
  proposed: {
    kind: 'ai',
    label: 'Order, p.1',
    quote: KARNATAKA_QUOTE,
    page: 1,
    anchorId: ANCHORS.karnataka.id,
    confidence: 0.91,
    state: 'proposed',
  },
  lowConfidence: {
    kind: 'capture',
    label: 'Diary photo',
    confidence: 0.62,
    state: 'confirmed',
  },
  edited: { kind: 'document', label: 'Order, p.2', page: 2, confidence: 0.97, state: 'edited' },
  manual: { kind: 'manual', label: 'Entered by you', state: 'confirmed' },
  adapter: { kind: 'adapter', label: 'Cause list', confidence: 0.99, state: 'confirmed' },
  import: { kind: 'import', label: 'Imported list', state: 'confirmed' },
  system: { kind: 'system', label: 'Computed date', state: 'confirmed' },
  rejected: { kind: 'ai', label: 'Order, p.3', confidence: 0.4, state: 'rejected' },
  longLabel: {
    kind: 'document',
    label: `Order dated 12 March 2026 in ${MADRAS_MATTER}, p.2`,
    confidence: 0.97,
    state: 'confirmed',
  },
  tamil: {
    kind: 'document',
    label: 'உத்தரவு, ப.2',
    anchorId: ANCHORS.tamil.id,
    confidence: 0.93,
    state: 'confirmed',
  },
  kannada: {
    kind: 'document',
    label: 'ಆದೇಶ, ಪು.1',
    anchorId: ANCHORS.kannada.id,
    confidence: 0.88,
    state: 'proposed',
  },
} satisfies Record<string, ProvenanceSource>;

export const PROPOSALS: Proposal<string>[] = [
  {
    id: 'proposal-next-hearing',
    title: 'Next hearing',
    before: '7 Nov 2026',
    after: '14 Nov 2026',
    source: SOURCES.confirmed,
    level: 'L2',
    safe: true,
  },
  {
    id: 'proposal-objections',
    title: 'Comply with office objections',
    after: 'By 17 Apr 2026',
    source: SOURCES.proposed,
    level: 'L2',
  },
];

/** Tamil and Kannada copy for pattern stories. */
export const PATTERN_INDIC = {
  ta: { filed: 'தாக்கல்', listed: 'பட்டியலிடப்பட்டது', suggested: 'பரிந்துரை' },
  kn: { filed: 'ದಾಖಲಾಗಿದೆ', listed: 'ಪಟ್ಟಿ ಮಾಡಲಾಗಿದೆ', suggested: 'ಸಲಹೆ' },
} as const;

/** Fixed "now" for stories and tests: 10:00 IST on 18 October 2026. */
export const NOW = new Date('2026-10-18T10:00:00+05:30');

const daysAgo = (days: number, hours = 0): string =>
  new Date(NOW.getTime() - (days * 24 + hours) * 60 * 60 * 1000).toISOString();

export const PEOPLE = {
  lawyer: { name: 'Meenakshi Sundaram' },
  junior: { name: 'Gowri Shankar' },
  system: { name: 'Lawyer OS' },
} as const;

/** Timeline entries for ActivityItem. */
export const ACTIVITIES = {
  attached: {
    id: 'activity-attached',
    actor: PEOPLE.system,
    sentence: `Attached order dated 12 Mar to ${ORDERS.madras.caseNumber}`,
    source: SOURCES.confirmed,
    level: 'L3',
    at: daysAgo(1),
  },
  hearing: {
    id: 'activity-hearing',
    actor: PEOPLE.system,
    sentence: 'Moved the next hearing to 14 Nov 2026',
    source: SOURCES.adapter,
    level: 'L3',
    at: daysAgo(6, 20),
  },
  expired: {
    id: 'activity-expired',
    actor: PEOPLE.junior,
    sentence: `Added office objections to ${ORDERS.karnataka.caseNumber}`,
    source: SOURCES.proposed,
    level: 'L2',
    at: daysAgo(9),
  },
  tamil: {
    id: 'activity-tamil',
    actor: PEOPLE.system,
    sentence: 'உத்தரவு W.P. 1234/2026 உடன் இணைக்கப்பட்டது',
    source: SOURCES.tamil,
    level: 'L3',
    at: daysAgo(2),
  },
  kannada: {
    id: 'activity-kannada',
    actor: PEOPLE.system,
    sentence: 'ಆದೇಶವನ್ನು W.P. 5678/2026 ಗೆ ಲಗತ್ತಿಸಲಾಗಿದೆ',
    source: SOURCES.kannada,
    level: 'L3',
    at: daysAgo(3),
  },
} as const;

/** Work rows for ObligationRow. */
export const OBLIGATIONS = {
  overdue: {
    id: 'obligation-counter',
    title: 'File counter affidavit',
    matter: MADRAS_MATTER,
    due: '2026-10-15',
    owner: PEOPLE.lawyer,
    source: SOURCES.confirmed,
  },
  today: {
    id: 'obligation-objections',
    title: 'Comply with office objections',
    matter: KARNATAKA_MATTER,
    due: '2026-10-18',
    owner: PEOPLE.junior,
    source: SOURCES.proposed,
  },
  upcoming: {
    id: 'obligation-vakalat',
    title: 'Carry vakalat copy',
    matter: MADRAS_MATTER,
    due: '2026-11-14',
    owner: PEOPLE.lawyer,
    source: SOURCES.manual,
  },
} as const;

/** Cause-list entries for CourtItemChip. */
export const COURT_ITEMS = {
  morning: {
    itemNo: 12,
    hall: 'Court Hall 4',
    stage: 'listed',
    time: '10:30',
    source: SOURCES.adapter,
  },
  afternoon: {
    itemNo: 64,
    hall: 'Court Hall 12',
    stage: 'part-heard',
    time: '14:15',
    source: SOURCES.adapter,
  },
  defects: {
    itemNo: 7,
    hall: 'Registry',
    stage: 'defects',
    time: '09:45',
    source: SOURCES.proposed,
  },
} as const;

/** Lawyer memory items for MemoryCard, one per scope. */
export const MEMORIES = {
  M1: {
    id: 'memory-m1',
    scope: 'M1',
    title: 'Courts',
    value: 'Madras HC Principal Seat',
    source: SOURCES.manual,
  },
  M2: {
    id: 'memory-m2',
    scope: 'M2',
    title: 'First hearings',
    value: "Always add 'carry vakalat copy'",
    source: SOURCES.proposed,
  },
  M3: {
    id: 'memory-m3',
    scope: 'M3',
    title: 'Next hearing',
    value: '14 Nov 2026',
    source: SOURCES.confirmed,
  },
  M4: {
    id: 'memory-m4',
    scope: 'M4',
    title: 'Court Hall 12',
    value: 'Takes fresh admissions after lunch',
    source: SOURCES.manual,
  },
  M5: {
    id: 'memory-m5',
    scope: 'M5',
    title: 'Standard prayer',
    value: 'Writ of certiorarified mandamus',
    source: SOURCES.import,
  },
  M6: {
    id: 'memory-m6',
    scope: 'M6',
    title: PARTIES.madras.petitioner,
    value: 'Prefers updates in Tamil',
    source: SOURCES.proposed,
  },
  M7: {
    id: 'memory-m7',
    scope: 'M7',
    title: 'Alias',
    value: 'Kaveri = M/s Kaveri Textiles',
    source: SOURCES.edited,
  },
} as const;
