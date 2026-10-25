// AIMS cause-list email profiles (#395, #396): the court's pilot email push to advocates who tag
// their cases (Notification 230/2026, research/raw/08 §2). `parseAimsEmail` picks the first profile
// whose subject matches, so a new template is config only. No real AIMS email was read yet: every
// profile below is an assumption built from the synthetic fixtures, to be checked against real
// emails with #119.

export const EMAIL_LAYOUTS = ['table', 'lines', 'pdf_only'] as const;
export type EmailLayout = (typeof EMAIL_LAYOUTS)[number];

/** What a table cell holds; `ignore` skips the column. */
export const EMAIL_COLUMNS = ['hall', 'item', 'case', 'parties', 'advocates', 'ignore'] as const;
export type EmailColumn = (typeof EMAIL_COLUMNS)[number];

export interface AimsEmailProfile {
  id: string;
  /** Regex source matched case-insensitively against the subject. */
  subject: string;
  layout: EmailLayout;
  /**
   * Regex source, case-insensitive, matched in the subject and then the body; group 1 is the list
   * date. Defaults to `DEFAULT_EMAIL_DATE_PATTERN`.
   */
  datePattern?: string;
  /** Table layouts: the meaning of each cell, in order. Defaults to item, case, parties, advocates. */
  columns?: readonly EmailColumn[];
  /** Regex source: the body's list starts after the first line matching it. */
  bodyStart?: string;
  /** Regex source: the body's list ends before the first line matching it. */
  bodyEnd?: string;
}

/** `for 23.10.2026`, `dated 23-10-2026`, `on 23/10/2026`. */
export const DEFAULT_EMAIL_DATE_PATTERN =
  '\\b(?:for|dated|on)\\s+(\\d{1,2}[./-]\\d{1,2}[./-](?:\\d{4}|\\d{2}))\\b';

export const DEFAULT_EMAIL_COLUMNS: readonly EmailColumn[] = [
  'item',
  'case',
  'parties',
  'advocates',
];

export const AIMS_EMAIL_PROFILES: readonly AimsEmailProfile[] = [
  // The list only as an attached PDF: the caller reads the attachment on its PDF path.
  { id: 'aims-pdf-v1', subject: '\\bcause\\s*list\\b.*\\(pdf\\)', layout: 'pdf_only' },
  // One table row per tagged case: hall, item, case, parties, advocates.
  {
    id: 'aims-tagged-table-v1',
    subject: '\\btagged\\s+cases\\b',
    layout: 'table',
    columns: ['hall', 'item', 'case', 'parties', 'advocates'],
    bodyEnd: '^(?:--\\s*$|This is a system generated)',
  },
  // The list printed as text, in the cause-list grammar (halls, benches, headings, rows).
  {
    id: 'aims-push-v1',
    subject: '\\bcause\\s*list\\b',
    layout: 'lines',
    bodyEnd: '^(?:--\\s*$|This is a system generated)',
  },
];
