// Server-only: the case types a forum's court adapter knows (#392), for the proceeding form's
// combobox. They come from the adapters' bundled nomenclature tables (Madras HC, Karnataka HC,
// NCLT Bengaluru), keyed by forum code; the process-wide adapter registry is not populated in the
// web app, so the constants are read directly. A custom forum, or one without an adapter, has no
// list and the form falls back to free text. The client gets only the option list and
// `compactCaseTypeCode` (case-type-code.ts), never `@causedeck/adapters`.
import {
  KARNATAKA_HC_CASE_TYPES,
  KARNATAKA_HC_FORUM_CODES,
  MADRAS_HC_CASE_TYPES,
  MADRAS_HC_FORUM_CODES,
  NCLT_FORUM_CODE,
  NCLT_PREFIXES,
} from '@causedeck/adapters';

export { compactCaseTypeCode } from './case-type-code.ts';

export interface CaseTypeOption {
  /** The adapter's compact code (`WP`). */
  code: string;
  /** As printed (`WP`, `CRL OP`, `CP(IB)`); what the form sends as the case type. */
  label: string;
  /** Other spellings the combobox also matches. */
  aliases: string[];
}

function fromTable(
  rows: readonly { code: string; label: string; aliases: readonly string[] }[],
): CaseTypeOption[] {
  return rows.map((row) => ({ code: row.code, label: row.label, aliases: [...row.aliases] }));
}

const BY_FORUM = new Map<string, CaseTypeOption[]>();
const madras = fromTable(MADRAS_HC_CASE_TYPES);
for (const code of MADRAS_HC_FORUM_CODES) BY_FORUM.set(code, madras);
const karnataka = fromTable(KARNATAKA_HC_CASE_TYPES);
for (const code of KARNATAKA_HC_FORUM_CODES) BY_FORUM.set(code, karnataka);
BY_FORUM.set(
  NCLT_FORUM_CODE,
  NCLT_PREFIXES.map((row) => ({ code: row.code, label: row.prefix, aliases: [] })),
);

/** The forum's case types, or `[]` when no adapter names them. */
export function caseTypeOptions(forumCode: string): CaseTypeOption[] {
  return BY_FORUM.get(forumCode) ?? [];
}
