// Deterministic document classification (docs/product/09 §9 cost lever): markers first, a model
// only for what these cannot settle. Each rule scores 0-1; the best score wins. Court documents
// open with their type, so the head of the text carries most weight.
import type { DocumentKind } from '@causedeck/db/schema';

export interface RuleResult {
  kind: DocumentKind;
  /** 0-1; at or above `RULE_CONFIDENT` the model is not asked. */
  score: number;
}

export const RULE_CONFIDENT = 0.8;

/** The head of the text where a title or bench line lives. */
const HEAD_CHARS = 1200;

const BENCH_LINE =
  /(PRESENT\s*:|HON'?BLE|HONOURABLE|\bBEFORE\b.*\bJUSTICE\b|\bCORAM\b|ಮಾನ್ಯ|மாண்புமிகு)/i;
const ORDER_TITLE = /(^|\n)\s*(ORDER|ORDERS|ORDER SHEET|ஆணை|ಆದೇಶ)\s*($|\n)/i;
const JUDGMENT_TITLE = /(^|\n)\s*(JUDGMENT|JUDGEMENT|COMMON JUDGMENT|தீர்ப்பு|ತೀರ್ಪು)\s*($|\n)/i;
const CAUSE_LIST_TITLE =
  /(CAUSE LIST|LIST OF BUSINESS|ADVANCE LIST|SUPPLEMENTARY LIST|DAILY LIST|வழக்குப் பட்டியல்|ವ್ಯಾಜ್ಯ ಪಟ್ಟಿ)/i;
const LIST_ROW =
  /^\s*\d{1,3}[.)]?\s+[A-Z][A-Za-z.() ]{0,15}\.?\s*(No\.?\s*)?\d{1,6}\s*\/\s*\d{2,4}/gm;
const REGISTRY_CUES =
  /(REGISTRY|REGISTRAR|OFFICE NOTE|OFFICE OBJECTION|OFFICE REPORT|OBJECTIONS? RAISED|DEFECTS? (NOTED|IN))/i;
const MEMO_CUES = /(MEMO|MEMORANDUM|NOTE|OBJECTION|REPORT)/i;
const IA_CUES =
  /(INTERLOCUTORY APPLICATION|\bI\.?\s?A\.?\s*(NO|\(?[A-Z]\)?)\b|MISCELLANEOUS PETITION|APPLICATION UNDER (ORDER|SECTION|ARTICLE))/i;
const PLEADING_CUES =
  /(PETITION|PLAINT|WRIT PETITION|WRITTEN STATEMENT|COUNTER[- ]AFFIDAVIT|AFFIDAVIT|MOST RESPECTFULLY SHEWETH|GROUNDS|PRAYER|IT IS THEREFORE PRAYED)/gi;
const ANNEXURE_TITLE =
  /^\s*(ANNEXURE|ANNEXURE[- ]?[A-Z0-9-]+|EXHIBIT\s*[A-Z]?-?\d+|DOCUMENT NO\.?\s*\d+)\b/im;
const CORRESPONDENCE_CUES =
  /(^|\n)\s*(DEAR (SIR|MADAM|SIRS)|TO,|SUBJECT\s*:|SUB\s*:|REF\s*:|YOURS (FAITHFULLY|SINCERELY|TRULY)|REGARDS,)/gi;

function count(pattern: RegExp, text: string): number {
  return [...text.matchAll(pattern)].length;
}

/** Every rule's result for `text`, best first; `other` at 0.3 when nothing matches. */
export function scoreRules(text: string): RuleResult[] {
  const head = text.slice(0, HEAD_CHARS);
  const results: RuleResult[] = [];
  const bench = BENCH_LINE.test(head);

  const listRows = count(LIST_ROW, text);
  if (CAUSE_LIST_TITLE.test(head)) results.push({ kind: 'cause_list', score: 0.95 });
  else if (listRows >= 5) results.push({ kind: 'cause_list', score: 0.85 });

  if (JUDGMENT_TITLE.test(head)) {
    results.push({ kind: 'judgment', score: bench ? 0.92 : 0.82 });
  }
  if (ORDER_TITLE.test(head)) results.push({ kind: 'order', score: bench ? 0.92 : 0.82 });
  else if (/PRESENT\s*:\s*HON'?BLE/i.test(head)) results.push({ kind: 'order', score: 0.85 });

  if (REGISTRY_CUES.test(head) && MEMO_CUES.test(head)) {
    results.push({ kind: 'registry_memo', score: 0.88 });
  }
  if (IA_CUES.test(head)) results.push({ kind: 'ia', score: 0.86 });

  const pleadingCues = count(PLEADING_CUES, text);
  if (pleadingCues >= 2) results.push({ kind: 'pleading', score: 0.88 });
  else if (pleadingCues === 1) results.push({ kind: 'pleading', score: 0.6 });

  if (ANNEXURE_TITLE.test(head)) results.push({ kind: 'annexure', score: 0.86 });

  const letterCues = count(CORRESPONDENCE_CUES, text);
  if (letterCues >= 2) results.push({ kind: 'correspondence', score: 0.85 });
  else if (letterCues === 1) results.push({ kind: 'correspondence', score: 0.55 });

  if (results.length === 0) results.push({ kind: 'other', score: 0.3 });
  return results.sort((a, b) => b.score - a.score);
}

export function classifyByRules(text: string): RuleResult {
  const [best] = scoreRules(text);
  return best ?? { kind: 'other', score: 0.3 };
}
