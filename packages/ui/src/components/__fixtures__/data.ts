// Table, data-table and date copy for stories and tests. Names are fictional.
import { COURTS, MATTERS, PEOPLE, STAGES } from './labels';

export interface MatterRow {
  id: string;
  title: string;
  court: string;
  stage: string;
  advocate: string;
  /** Next hearing as an ISO date (yyyy-mm-dd). */
  nextHearing: string;
  /** Pending fee in rupees. */
  feeDue: number;
}

const ADVOCATES = [PEOPLE.advocate, PEOPLE.junior, PEOPLE.clerk, PEOPLE.long] as const;

const pad = (value: number) => String(value).padStart(2, '0');

/** One deterministic row: the same index always gives the same matter. */
export function matterRow(index: number): MatterRow {
  const court = COURTS[index % COURTS.length];
  const stage = STAGES[index % STAGES.length];
  const day = (index % 28) + 1;
  const month = (index % 12) + 1;
  return {
    id: `m-${String(index + 1)}`,
    title: MATTERS[index % MATTERS.length] ?? MATTERS[0],
    court: court?.label ?? '',
    stage: stage?.label ?? '',
    advocate: ADVOCATES[index % ADVOCATES.length] ?? PEOPLE.advocate,
    nextHearing: `2026-${pad(month)}-${pad(day)}`,
    feeDue: ((index * 7919) % 250) * 1000,
  };
}

/** `count` deterministic rows (the perf story uses 5,000). */
export function matterRows(count: number): MatterRow[] {
  return Array.from({ length: count }, (_, index) => matterRow(index));
}

/** A short list for the everyday stories. */
export const MATTER_ROWS: MatterRow[] = matterRows(6);

export const MATTER_COLUMNS = {
  title: 'Matter',
  court: 'Court',
  stage: 'Stage',
  advocate: 'Advocate',
  nextHearing: 'Next hearing',
  feeDue: 'Fee due',
} as const;

/** Tamil and Kannada column headers and data-state copy. */
export const INDIC_DATA = {
  ta: {
    title: 'வழக்கு',
    court: 'நீதிமன்றம்',
    stage: 'நிலை',
    advocate: 'வழக்கறிஞர்',
    nextHearing: 'அடுத்த விசாரணை',
    feeDue: 'நிலுவைக் கட்டணம்',
    empty: 'வழக்குகள் இல்லை',
    selectRow: 'வரிசையைத் தேர்ந்தெடு',
    selectAll: 'அனைத்தையும் தேர்ந்தெடு',
    columns: 'நெடுவரிசைகள்',
    pickDate: 'தேதியைத் தேர்ந்தெடு',
    hearingDate: 'விசாரணைத் தேதி',
  },
  kn: {
    title: 'ಪ್ರಕರಣ',
    court: 'ನ್ಯಾಯಾಲಯ',
    stage: 'ಹಂತ',
    advocate: 'ವಕೀಲರು',
    nextHearing: 'ಮುಂದಿನ ವಿಚಾರಣೆ',
    feeDue: 'ಬಾಕಿ ಶುಲ್ಕ',
    empty: 'ಪ್ರಕರಣಗಳಿಲ್ಲ',
    selectRow: 'ಸಾಲು ಆಯ್ಕೆಮಾಡಿ',
    selectAll: 'ಎಲ್ಲವನ್ನೂ ಆಯ್ಕೆಮಾಡಿ',
    columns: 'ಕಾಲಮ್‌ಗಳು',
    pickDate: 'ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ',
    hearingDate: 'ವಿಚಾರಣೆಯ ದಿನಾಂಕ',
  },
} as const;

/** Sample court holidays (illustrative only; real calendars arrive with the court data). */
export const COURT_HOLIDAYS_2026 = [
  { date: '2026-03-04', name: 'Holi' },
  { date: '2026-03-19', name: 'Ugadi' },
  { date: '2026-04-14', name: 'Tamil New Year' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
] as const;

/** Hearing dates used by the calendar and date-picker stories. */
export const HEARING_DATE = '2026-03-12';
