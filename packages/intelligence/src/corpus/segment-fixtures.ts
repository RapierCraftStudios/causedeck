// The labelled evaluation set for segment roles (#893): 24 synthetic redacted judgments built from
// wording pools per role, each paragraph labelled by construction. Synthetic because the hand-labelled
// real judgments (#119) are still being collected; the report (SEGMENT-EVALUATION.md) says so. The pools
// vary cue wording and structure (numbered or plain paragraphs, one to three pages, length) so the
// rules are measured on phrasing they were not written against paragraph by paragraph.
import type { SegmentRole } from './segment.ts';

export interface LabelledSegmentJudgment {
  id: string;
  pages: { pageNo: number; text: string }[];
  /** The role of each paragraph, in order. */
  roles: SegmentRole[];
}

const SUBJECTS = [
  ['the Appellant', 'a medical negligence claim', 'Section 304A of the Indian Penal Code'],
  ['the Petitioner', 'an order of detention', 'Article 21 of the Constitution'],
  [
    'the Respondent',
    'a cheque dishonour complaint',
    'Section 138 of the Negotiable Instruments Act',
  ],
  ['the Appellant', 'a land acquisition award', 'Section 24 of the 2013 Act'],
  ['Accused 1', 'a murder trial', 'Section 302 of the Indian Penal Code'],
  ['the Petitioner', 'a service dispute over seniority', 'Article 14 of the Constitution'],
  [
    'the Complainant',
    'a consumer complaint for deficiency in service',
    'Section 35 of the Consumer Protection Act',
  ],
  ['the Appellant', 'a challenge to an arbitral award', 'Section 34 of the Arbitration Act'],
] as const;

type Pool = ((who: string, matter: string, law: string) => string)[];

const POOLS: Record<SegmentRole, Pool> = {
  header: [
    (w, m) =>
      `IN THE SUPREME COURT OF INDIA\nCIVIL APPEAL NO. 4821 OF 2024\n${w} versus State of Karnataka\nBEFORE: HON'BLE MR. JUSTICE A. KUMAR`,
    (w, m) =>
      `IN THE HIGH COURT OF JUDICATURE AT MADRAS\nW.P. No. 1922 of 2023\n${w} vs. Union of India\nCORAM: THE HON'BLE MRS. JUSTICE R. DEVI\nJUDGMENT`,
    (w) =>
      `REPORTABLE\nCRIMINAL APPEAL NO. 77 OF 2022\n${w} v. State of Tamil Nadu\nDate of Decision: 12.03.2025`,
  ],
  facts: [
    (w, m) =>
      `The brief facts are these. ${w} filed a complaint on 14.02.2019 concerning ${m}, and the matter was registered before the trial court the same month.`,
    (w, m) =>
      `The case of the prosecution is that ${w} was arrested on 03.06.2018 after an FIR was lodged, and a chargesheet was filed in due course in respect of ${m}.`,
    (w, m) =>
      `${w} was employed with the respondent bank from 2004. On 9.1.2017 the dispute concerning ${m} arose, and the High Court by its order dated 21.8.2021 disposed of the first writ.`,
    (w, m) =>
      `Factual background: ${w} purchased the property in 2010 and thereafter approached the tribunal in connection with ${m}; the tribunal had passed an interim order on 5.5.2016.`,
  ],
  issues: [
    (w, m, l) =>
      `The question for consideration is whether ${w} can invoke ${l} in a case of ${m}.`,
    (w, m, l) =>
      `Having heard the parties, the following issues arise for determination: whether ${l} applies to ${m}, and whether the High Court was right in interfering?`,
    (w, m, l) =>
      `The short question that falls for our consideration is whether the conditions of ${l} stand satisfied.`,
  ],
  arguments: [
    (w, m, l) =>
      `Learned senior counsel for ${w} submitted that the courts below erred in law, and that ${l} was wrongly applied to ${m}.`,
    (w, m, l) =>
      `Learned counsel appearing for the State contended that no interference is called for, and urged that the findings on ${m} are findings of fact.`,
    (w, m, l) =>
      `On the other hand, it was argued by counsel for the respondent that ${w} had suffered no prejudice, relying on ${l}.`,
    (w, m) =>
      `We have heard the learned counsel for the parties at length. Their submissions on ${m} were canvassed in detail.`,
  ],
  reasoning: [
    (w, m, l) =>
      `We are of the view that ${l} must be read in its context. This Court has held in several decisions that the principle applies only where the facts of ${m} warrant it.`,
    (w, m, l) =>
      `In our opinion the test laid down for ${l} is not met. The doctrine cannot be extended to ${m}, and the reasoning of the High Court does not survive scrutiny.`,
    (w, m, l) =>
      `Section 5 of the Act provides that the limitation runs from the date of knowledge. Applying the settled position to ${m}, we find that ${w} could not have been unaware of the order; therefore the delay is not explained.`,
    (w, m, l) =>
      `It is well settled that ${l} is to be construed strictly. We have perused the record of ${m} and consequently hold that the finding cannot be sustained.`,
  ],
  decision: [
    (w, m) =>
      `In the result, the appeal is allowed. The impugned judgment is set aside and the matter is remanded. There shall be no order as to costs.`,
    (w, m) =>
      `For the reasons recorded above, the petition is accordingly dismissed. Pending applications, if any, stand disposed of.`,
    (w, m) =>
      `We accordingly allow the appeal, quash the order and direct the respondent to comply within a period of eight weeks. Costs of Rs. 25,000 shall be paid.`,
  ],
  other: [],
};

const PLAN: SegmentRole[][] = [
  [
    'header',
    'facts',
    'facts',
    'issues',
    'arguments',
    'arguments',
    'reasoning',
    'reasoning',
    'decision',
  ],
  ['header', 'facts', 'issues', 'arguments', 'reasoning', 'reasoning', 'reasoning', 'decision'],
  ['header', 'facts', 'facts', 'facts', 'arguments', 'issues', 'reasoning', 'decision', 'decision'],
  ['header', 'facts', 'arguments', 'reasoning', 'reasoning', 'decision'],
];

/** A deterministic pick, so the set is the same on every run. */
const pick = <T>(items: readonly T[], seed: number): T => items[seed % items.length] as T;

function build(n: number): LabelledSegmentJudgment {
  const [who, matter, law] = pick(SUBJECTS, n);
  const plan = pick(PLAN, n + Math.floor(n / 4));
  const numbered = n % 3 !== 0;
  let number = 0;
  const roles: SegmentRole[] = [];
  const paragraphs: string[] = [];
  for (const [i, role] of plan.entries()) {
    const pool = POOLS[role];
    const body = pick(pool, n * 3 + i)(who, matter, law);
    roles.push(role);
    if (role === 'header') {
      paragraphs.push(body);
      continue;
    }
    number += 1;
    paragraphs.push(numbered ? `${String(number)}. ${body}` : body);
  }
  const split = Math.max(1, Math.ceil(paragraphs.length / (1 + (n % 3))));
  const pages: { pageNo: number; text: string }[] = [];
  for (let i = 0; i < paragraphs.length; i += split) {
    const last = i + split >= paragraphs.length;
    // A page that ends between paragraphs ends with a newline, so the joined text keeps the blank line.
    pages.push({
      pageNo: pages.length + 1,
      text: paragraphs.slice(i, i + split).join('\n\n') + (last ? '' : '\n'),
    });
  }
  return { id: `seg-${String(n).padStart(2, '0')}`, pages, roles };
}

export const SEGMENT_FIXTURES: LabelledSegmentJudgment[] = Array.from({ length: 24 }, (_, i) =>
  build(i),
);
