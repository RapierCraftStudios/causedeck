// NCLT case prefixes (#38, ADR 0019). `CP(IB) No. 132/BB/2022` is verified from the 2023
// Bengaluru list (research/raw/09 §2.2); the others are the prefixes NCLT benches are known to use
// and are assumptions until real lists confirm them (#119). Each prefix normalises to its compact
// code (`CP(IB)` -> `CPIB`, `compactCaseType`); the code's leading letters say what it is: `CP` /
// `TCP` start a matter, `IA`, `CA` and `MA` are applications nested under one. These feed
// `NCLT_CONFIG.nomenclature.caseTypes`.

export interface NcltPrefix {
  /** As printed. */
  prefix: string;
  /** Compact code, the `caseType` of a parsed row. */
  code: string;
}

export const NCLT_PREFIXES: readonly NcltPrefix[] = [
  { prefix: 'CP(IB)', code: 'CPIB' },
  { prefix: 'CP(CAA)', code: 'CPCAA' },
  { prefix: 'CA(CAA)', code: 'CACAA' },
  { prefix: 'IA(IB)', code: 'IAIB' },
  { prefix: 'IA(Plan)', code: 'IAPLAN' },
  { prefix: 'TCP', code: 'TCP' },
  { prefix: 'CP', code: 'CP' },
  { prefix: 'CA', code: 'CA' },
  { prefix: 'MA', code: 'MA' },
  { prefix: 'IA', code: 'IA' },
];

/** The kind of application a code names, or null for a matter (`CP...`, `TCP`) or an unknown code. */
export type NcltChildKind = 'IA' | 'CA' | 'MA';

export function childKindOf(code: string): NcltChildKind | null {
  if (code.startsWith('IA')) return 'IA';
  if (code.startsWith('CA')) return 'CA';
  if (code.startsWith('MA')) return 'MA';
  return null;
}
