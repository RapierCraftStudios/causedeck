// The Supreme Court Reports citation in a member name of the AWS Supreme Court dataset (#1189). Each
// PDF is named `YYYY_V_P1_P2_<LANG>.pdf`: year, volume, first and last page of the judgment in that
// year's SCR volume, then the language of the text. `2008_9_821_869_EN.pdf` is `[2008] 9 SCR 821`.
// Only the English member yields the citation: a regional-language member is a translation of it
// and is not cited on its own (it shares the English original's citation), and a name of any other
// shape yields none. The citation goes into `judgment.case_numbers`, never `neutral_citation`, which
// holds only canonical neutral citations (`verifyCitation` resolves on that column alone).

/** The source id of the AWS Supreme Court dataset; its rows are all Supreme Court of India rows. */
export const AWS_SC_SOURCE_ID = 'aws-open-data-sc';

/** The court code of the Supreme Court of India, as printed in its neutral citations (`2023 INSC 1`). */
export const SUPREME_COURT_CODE = 'INSC';

const MEMBER = /^(\d{4})_(\d{1,3})_(\d{1,5})_(\d{1,5})_([a-z]{2,3})\.pdf$/i;

/** `[YYYY] V SCR P1` for an English member `YYYY_V_P1_P2_EN.pdf` (any directory prefix), else null. */
export function parseScrCitation(entryName: string): string | null {
  const base = entryName.split(/[\\/]/).pop() ?? '';
  const match = MEMBER.exec(base);
  if (match === null) return null;
  const [, year, volume, first, last, language] = match;
  if (language?.toUpperCase() !== 'EN') return null;
  const y = Number(year);
  const v = Number(volume);
  const p1 = Number(first);
  const p2 = Number(last);
  if (y < 1950 || v < 1 || p1 < 1 || p2 < p1) return null;
  return `[${String(y)}] ${String(v)} SCR ${String(p1)}`;
}
