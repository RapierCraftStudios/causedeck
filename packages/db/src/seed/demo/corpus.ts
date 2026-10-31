// The synthetic judgment corpus of the demo seed (#1070): 24 invented judgments with segments, subject
// tags, statute and citation references, so `/research`, the matter research tab and judgment alerts
// have results on a review database without a provider. Everything here is fiction:
//
// - Each page opens with `SYNTHETIC - DEMO DATA - FICTIONAL`; the text is template prose written for
//   this seed, never taken from a court. The neutral citations sit in the 9xxxxx range of each court's
//   sequence so they cannot be mistaken for a real decision, and no bench is recorded (identity ban:
//   no judge names, no judge ratings).
// - Titles are in the masked form (`[name withheld] v. <institution> (fictional)`); the matrimonial
//   judgments carry the `matrimonial` sensitive category as the redaction pass would set it. No page
//   reproduces a reporter (SCC) headnote or text.
// - The rows are global (no `workspace_id`), deterministic (fixed ids, fixed dates) and written once by
//   `seedDemoCatalogue`. The segment embeddings are NOT written here: `@causedeck/db` cannot import
//   the embedder, so `pnpm db:seed:demo:content` (`@causedeck/core`, `seedDemoCorpusEmbeddings`) fills
//   them with the mock embedder, the one `searchAuthorities` queries with.
import { createHash } from 'node:crypto';

import type {
  judgment,
  judgmentCitationRef,
  judgmentSegment,
  judgmentStatuteRef,
  judgmentTag,
} from '../../schema/corpus.ts';

import { demoId, ID_KIND } from './shared.ts';

export type DemoJudgmentRow = typeof judgment.$inferInsert;
export type DemoSegmentRow = typeof judgmentSegment.$inferInsert;
export type DemoTagRow = typeof judgmentTag.$inferInsert;
export type DemoStatuteRefRow = typeof judgmentStatuteRef.$inferInsert;
export type DemoCitationRefRow = typeof judgmentCitationRef.$inferInsert;

/** Source id of every demo judgment (`judgment.source_id` is free text; no registry row is needed). */
export const DEMO_CORPUS_SOURCE_ID = 'demo.synthetic.corpus';

/** Mirrors `REDACTION_VERSION`, `SEGMENT_VERSION` and `ENRICH_VERSION` of `@causedeck/intelligence` (core's demo test pins them). */
export const DEMO_CORPUS_VERSIONS = { redaction: 1, segment: 1, enrich: 1 } as const;

/** The model version of the demo subject tags (the gateway's tags carry the model that produced them). */
export const DEMO_TAG_MODEL_VERSION = 'demo-synthetic-1';

const CORPUS_FETCHED_AT = '2026-01-01T00:00:00.000Z';
const FIRST_JUDGMENT_DAY = Date.UTC(2025, 0, 10);
const DAY_MS = 86_400_000;
export const DEMO_JUDGMENT_COUNT = 24;

/** One subject area of the corpus vocabulary (`SUBJECT_AREAS` of `@causedeck/intelligence`). */
interface AreaSpec {
  area: string;
  /** `normaliseStatute` and `normaliseSection` keys of the section the judgments of the area cite. */
  statute: string;
  section: string;
  /** The respondent institution of the masked title. */
  respondent: string;
  facts: string;
  issue: string;
  reasoning: string;
}

const AREAS: readonly AreaSpec[] = [
  {
    area: 'medical_negligence',
    statute: 'consumer protection act',
    section: '2(11)',
    respondent: 'Demo General Hospital (fictional)',
    facts:
      'The complainant underwent a surgical procedure at the hospital and alleged deficiency in post-operative care, claiming compensation for the lapse in nursing and monitoring.',
    issue:
      'Whether the hospital owed a duty of care and whether the record shows a breach of the accepted standard of medical practice amounting to negligence.',
    reasoning:
      'The test is that of an ordinary skilled medical professional. The expert opinion, the consent form and the nursing notes were examined to see whether the treatment departed from standard practice.',
  },
  {
    area: 'consumer',
    statute: 'consumer protection act',
    section: '35',
    respondent: 'Demo Appliances Retail (fictional)',
    facts:
      'The complainant bought a refrigerator that failed within the warranty period; the seller refused repair and replacement, and the complainant approached the consumer commission for a refund.',
    issue:
      'Whether the defect in the appliance is a deficiency in service or a defect in goods and what relief the consumer commission may grant.',
    reasoning:
      'The warranty card, the service requests and the invoice show the defect was reported in time. The commission has power to direct repair, replacement or refund of the price with costs.',
  },
  {
    area: 'rent_control',
    statute: 'tamil nadu buildings lease and rent control act',
    section: '10',
    respondent: 'Demo Tenants Association (fictional)',
    facts:
      'The landlord sought eviction of a commercial tenant for wilful default in paying rent for fourteen months, and the tenant denied the default and pleaded part payment by money order.',
    issue:
      'Whether the tenant committed wilful default in the payment of rent and whether eviction follows under the rent control statute.',
    reasoning:
      'Wilful default requires a conscious refusal to pay. The rent receipts and the money order counterfoils were compared with the rent ledger to find the arrears and their cause.',
  },
  {
    area: 'motor_accident_claims',
    statute: 'motor vehicles act',
    section: '166',
    respondent: 'Demo Mutual Insurance Company (fictional)',
    facts:
      'The claimants are the dependants of a pillion rider who died in a collision with a lorry; the insurer contested negligence and the quantum of compensation awarded by the tribunal.',
    issue:
      'Whether the accident was caused by rash and negligent driving and whether the multiplier and the future prospects were correctly applied in assessing the compensation.',
    reasoning:
      'The first information report, the site plan and the witness evidence establish the manner of the accident. The compensation is assessed on the income, the age of the deceased and the number of dependants.',
  },
  {
    area: 'ndps',
    statute: 'narcotic drugs and psychotropic substances act',
    section: '37',
    respondent: 'Demo Narcotics Control Unit (fictional)',
    facts:
      'The accused was arrested with a commercial quantity of a contraband substance and sought release, contending that the search and seizure did not follow the mandatory procedure.',
    issue:
      'Whether the statutory safeguards on search, seizure and sampling were complied with and whether the twin conditions for release are satisfied.',
    reasoning:
      'The seizure mahazar, the sample forwarding note and the chain of custody were examined. Non-compliance with a mandatory safeguard weighs on whether the rigour of the section applies.',
  },
  {
    area: 'bail',
    statute: 'code of criminal procedure',
    section: '439',
    respondent: 'State Represented by the Inspector of Police (fictional)',
    facts:
      'The petitioner has been in custody for eleven months in an offence of cheating and criminal breach of trust; the charge sheet is filed and the trial has not begun.',
    issue:
      'Whether the petitioner is entitled to regular bail having regard to the period of custody, the stage of the trial and the risk of tampering with evidence.',
    reasoning:
      'Bail is the rule and refusal the exception. The nature of the accusation, the evidence collected, the delay in the trial and the likelihood of the accused absconding were weighed together.',
  },
  {
    area: 'arbitration',
    statute: 'arbitration and conciliation act',
    section: '34',
    respondent: 'Demo Infrastructure Projects Limited (fictional)',
    facts:
      'The respondent obtained an award for the balance contract price; the petitioner applied to set aside the award, alleging that the tribunal ignored the termination clause of the contract.',
    issue:
      'Whether the award is in conflict with the public policy of India or suffers from patent illegality on the face of the record within the narrow scope of the section.',
    reasoning:
      'The court does not sit in appeal over an arbitral award. It examines only whether the grounds of the section are made out, and a plausible view of the contract by the tribunal is not interfered with.',
  },
  {
    area: 'ibc',
    statute: 'insolvency and bankruptcy code',
    section: '7',
    respondent: 'Demo Steel Components Private Limited (fictional)',
    facts:
      'A financial creditor moved to initiate the corporate insolvency resolution process on a default under a term loan, and the corporate debtor disputed the date of default.',
    issue:
      'Whether a financial debt and a default are established on the record of the information utility so as to admit the application.',
    reasoning:
      'The adjudicating authority is to be satisfied of the existence of a financial debt and a default. The loan agreement, the statement of account and the recall notice were considered for the date of default and limitation.',
  },
  {
    area: 'service',
    statute: 'constitution of india',
    section: '311',
    respondent: 'Demo Revenue Department (fictional)',
    facts:
      'A government clerk was removed from service after a departmental inquiry on a charge of unauthorised absence, and challenged the order as passed without an effective opportunity of hearing.',
    issue:
      'Whether the inquiry observed the principles of natural justice and whether the punishment is proportionate to the proved misconduct.',
    reasoning:
      'Judicial review of a disciplinary order is limited to the decision-making process. The service of the charge memo, the examination of witnesses and the reasons of the disciplinary authority were reviewed.',
  },
  {
    area: 'criminal_appeal',
    statute: 'code of criminal procedure',
    section: '374',
    respondent: 'State by the Public Prosecutor (fictional)',
    facts:
      'The appellant was convicted of causing grievous hurt in a village quarrel and challenges the conviction on the ground of contradictions in the evidence of the eyewitnesses.',
    issue:
      'Whether the prosecution proved the offence beyond reasonable doubt and whether the contradictions go to the root of the case.',
    reasoning:
      'The appellate court re-appreciates the evidence. Minor discrepancies do not affect a reliable witness, but material contradictions on the identity of the assailant and the weapon call for caution.',
  },
  {
    area: 'cheque_dishonour',
    statute: 'negotiable instruments act',
    section: '138',
    respondent: 'Demo Trading Company (fictional)',
    facts:
      'A cheque issued in discharge of a loan was returned unpaid for insufficiency of funds; the statutory notice was sent and the drawer did not pay within the fifteen days allowed.',
    issue:
      'Whether the ingredients of the offence are made out, including the legally enforceable debt, the presentation within validity and the service of the demand notice.',
    reasoning:
      'The presumption in favour of the holder is rebuttable on the standard of probability. The bank memo, the notice and the postal acknowledgement were read with the defence of a blank cheque given as security.',
  },
  {
    area: 'land_acquisition',
    statute: 'land acquisition act',
    section: '4',
    respondent: 'Demo Highway Authority (fictional)',
    facts:
      'The landowners challenged the acquisition of agricultural land for a bypass road, contending that the notification was not published in the manner required and compensation was inadequate.',
    issue:
      'Whether the preliminary notification and the declaration complied with the statute and whether the market value was fixed on relevant sale instances.',
    reasoning:
      'Strict compliance with the publication requirements is demanded of the acquiring authority. The sale deeds of comparable lands in the vicinity were weighed to arrive at the market value.',
  },
  {
    area: 'family_matrimonial',
    statute: 'hindu marriage act',
    section: '13',
    respondent: 'Demo Spouse Respondent (fictional)',
    facts:
      'The petitioner sought dissolution of marriage on the ground of cruelty after a long separation, and the respondent opposed the petition and sought restitution of conjugal rights.',
    issue:
      'Whether the acts alleged amount to cruelty in law and whether the marriage has broken down beyond repair.',
    reasoning:
      'Cruelty is judged on the totality of the conduct and its effect on the other spouse. The pleadings, the period of separation and the failed mediation attempts were taken into account.',
  },
  {
    area: 'property_title',
    statute: 'transfer of property act',
    section: '54',
    respondent: 'Demo Land Holdings (fictional)',
    facts:
      'The plaintiff claimed specific performance of an agreement of sale of a house site and the defendant pleaded that the agreement was never executed and the title was defective.',
    issue:
      'Whether a valid agreement of sale was proved and whether the plaintiff was ready and willing to perform his part throughout.',
    reasoning:
      'Readiness and willingness are to be proved from conduct and not by a bare averment. The sale agreement, the encumbrance certificate and the notices exchanged were analysed.',
  },
  {
    area: 'tax',
    statute: 'income tax act',
    section: '148',
    respondent: 'Demo Assessing Officer (fictional)',
    facts:
      'The assessee challenged a notice to reopen an assessment after four years, saying that all material facts were disclosed and no fresh tangible material existed.',
    issue:
      'Whether the reopening is a mere change of opinion and whether there was failure to disclose fully and truly all material facts.',
    reasoning:
      'The reasons recorded for reopening must show a live link between the material and the belief of escaped income. The return, the scrutiny record and the reasons were compared.',
  },
  {
    area: 'labour_industrial',
    statute: 'industrial disputes act',
    section: '25f',
    respondent: 'Demo Textile Mills Limited (fictional)',
    facts:
      'A workman, engaged as a loom operator for six years, was terminated without notice or retrenchment compensation and raised an industrial dispute for reinstatement with back wages.',
    issue:
      'Whether the termination amounts to retrenchment and whether the conditions precedent of notice and compensation were fulfilled.',
    reasoning:
      'Continuous service of two hundred and forty days is shown from the attendance register. Failure to follow the conditions of the section renders the termination invalid, and the relief is moulded accordingly.',
  },
  {
    area: 'constitutional_writ',
    statute: 'constitution of india',
    section: '226',
    respondent: 'Demo Municipal Corporation (fictional)',
    facts:
      'The petitioner, a street vendor, challenged the sealing of a stall without notice and sought a direction to the corporation to consider the vending certificate application.',
    issue:
      'Whether the action violates the right to a hearing and whether the writ court should interfere in the exercise of its discretionary jurisdiction.',
    reasoning:
      'The writ court examines the fairness of the process and not the merits of the decision. An order affecting livelihood passed without notice is liable to be set aside on the ground of natural justice.',
  },
  {
    area: 'company',
    statute: 'companies act',
    section: '241',
    respondent: 'Demo Spice Exports Private Limited (fictional)',
    facts:
      'A minority shareholder alleged oppression and mismanagement by the majority directors, citing an allotment of shares at an undervalue that diluted the petitioner holding.',
    issue:
      'Whether the affairs of the company were conducted in a manner prejudicial to the members and whether a winding up would unfairly prejudice them.',
    reasoning:
      'Oppression must be continuous and visible, not a single isolated act. The board minutes, the valuation report and the share register were examined for the fairness of the allotment.',
  },
  {
    area: 'intellectual_property',
    statute: 'trade marks act',
    section: '29',
    respondent: 'Demo Herbal Products (fictional)',
    facts:
      'The plaintiff sells tea under a registered mark and alleged that the defendant adopted a deceptively similar mark and packaging, and sought an interim injunction.',
    issue:
      'Whether the marks are deceptively similar and whether the plaintiff has made out a prima facie case, balance of convenience and irreparable injury.',
    reasoning:
      'Similarity is judged on the overall impression on a person of average intelligence and imperfect recollection. The marks, the trade dress and the channels of trade were compared side by side.',
  },
  {
    area: 'environment',
    statute: 'environment protection act',
    section: '15',
    respondent: 'Demo Chemical Works Limited (fictional)',
    facts:
      'Residents complained that an industrial unit discharged untreated effluent into a stream, and the pollution control board issued a closure direction that the unit challenged.',
    issue:
      'Whether the discharge exceeded the consent conditions and whether the closure direction is proportionate and follows the precautionary principle.',
    reasoning:
      'The precautionary and polluter-pays principles guide the court. The sampling reports, the consent to operate and the inspection record were considered in testing the direction.',
  },
];

const OUTCOMES = [
  { outcome: 'allowed', sentence: 'In the result, the petition is allowed.' },
  { outcome: 'dismissed', sentence: 'In the result, the petition is dismissed.' },
  { outcome: 'partly_allowed', sentence: 'In the result, the petition is allowed in part.' },
  {
    outcome: 'remanded',
    sentence: 'In the result, the matter is remanded for fresh consideration.',
  },
  {
    outcome: 'disposed',
    sentence: 'In the result, the petition is disposed of with the above observations.',
  },
] as const;

const HEADING = 'SYNTHETIC - DEMO DATA - FICTIONAL';

export interface DemoJudgmentSpec {
  index: number;
  id: string;
  court: 'MHC' | 'KHC';
  citation: string;
  date: string;
  year: number;
  primary: AreaSpec;
  secondary: AreaSpec;
  title: string;
  outcome: (typeof OUTCOMES)[number];
  pages: { pageNo: number; text: string }[];
}

const citationOf = (court: 'MHC' | 'KHC', year: number, i: number): string =>
  `${String(year)}:${court}:${String(900_001 + i)}`;

function specOf(i: number): DemoJudgmentSpec {
  const primary = AREAS[i % AREAS.length] as AreaSpec;
  const secondary = AREAS[(i + 1) % AREAS.length] as AreaSpec;
  const court = i % 2 === 0 ? 'MHC' : 'KHC';
  const date = new Date(FIRST_JUDGMENT_DAY + i * 17 * DAY_MS).toISOString().slice(0, 10);
  const year = Number(date.slice(0, 4));
  const outcome = OUTCOMES[i % OUTCOMES.length] as (typeof OUTCOMES)[number];
  const citation = citationOf(court, year, i);
  const courtName =
    court === 'MHC' ? 'THE HIGH COURT OF JUDICATURE AT MADRAS' : 'THE HIGH COURT OF KARNATAKA';
  const title = `[name withheld] v. ${primary.respondent}`;
  const ref = `DEMO-J${String(i + 1).padStart(3, '0')} of ${String(year)}`;
  const pages = [
    {
      pageNo: 1,
      text: [
        HEADING,
        `IN ${courtName} (synthetic)`,
        title,
        `Case No. ${ref}`,
        citation,
        `Dated: ${date}`,
        'Judgment text written for the demonstration workspace. It is not a decision of any court.',
      ].join('\n'),
    },
    {
      pageNo: 2,
      text: [
        HEADING,
        `Facts. ${primary.facts}`,
        `Issues. ${primary.issue}`,
        `A related question arose on ${secondary.area.replace(/_/g, ' ')}: ${secondary.issue}`,
      ].join('\n'),
    },
    {
      pageNo: 3,
      text: [
        HEADING,
        `Reasoning. ${primary.reasoning}`,
        `The authorities on ${primary.area.replace(/_/g, ' ')} cited by the parties were considered in the light of section ${primary.section} of the ${primary.statute}.`,
        outcome.sentence,
      ].join('\n'),
    },
  ];
  return {
    index: i,
    id: demoId(ID_KIND.judgment, i + 1),
    court,
    citation,
    date,
    year,
    primary,
    secondary,
    title,
    outcome,
    pages,
  };
}

/** The specs of every demo judgment, in id order. */
export const DEMO_JUDGMENTS: readonly DemoJudgmentSpec[] = Array.from(
  { length: DEMO_JUDGMENT_COUNT },
  (_, i) => specOf(i),
);

export const DEMO_SUBJECT_AREAS: readonly string[] = AREAS.map((a) => a.area);

export interface DemoCorpusRows {
  judgments: DemoJudgmentRow[];
  segments: DemoSegmentRow[];
  tags: DemoTagRow[];
  statuteRefs: DemoStatuteRefRow[];
  citationRefs: DemoCitationRefRow[];
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The (statute, section, page) a judgment cites: its primary section and its secondary one. */
export function demoStatuteCites(
  spec: DemoJudgmentSpec,
): { statute: string; section: string; page: number }[] {
  const cites = [{ statute: spec.primary.statute, section: spec.primary.section, page: 3 }];
  if (
    spec.secondary.statute !== spec.primary.statute ||
    spec.secondary.section !== spec.primary.section
  ) {
    cites.push({ statute: spec.secondary.statute, section: spec.secondary.section, page: 2 });
  }
  return cites;
}

/** The rows of the whole corpus. Pure and deterministic: no clock, no randomness. */
export function demoCorpusRows(): DemoCorpusRows {
  const rows: DemoCorpusRows = {
    judgments: [],
    segments: [],
    tags: [],
    statuteRefs: [],
    citationRefs: [],
  };
  const createdAt = new Date(CORPUS_FETCHED_AT);
  const v = DEMO_CORPUS_VERSIONS;
  for (const spec of DEMO_JUDGMENTS) {
    const n = spec.index + 1;
    const pageText = spec.pages;
    const decisionLine = spec.outcome.sentence;
    const matrimonial = spec.primary.area === 'family_matrimonial';
    rows.judgments.push({
      id: spec.id,
      sourceId: DEMO_CORPUS_SOURCE_ID,
      court: spec.court,
      neutralCitation: spec.citation,
      caseNumbers: [`DEMO-J${String(n).padStart(3, '0')} of ${String(spec.year)}`],
      bench: [],
      judgmentDate: spec.date,
      sha256: sha256(`demo-judgment:${spec.id}:${pageText.map((p) => p.text).join('\n')}`),
      provenance: {
        url: `https://demo.causedeck.test/corpus/${spec.id}`,
        fetchedAt: CORPUS_FETCHED_AT,
        sha256: sha256(`demo-provenance:${spec.id}`),
        sourceId: DEMO_CORPUS_SOURCE_ID,
        sourceVersion: 'demo-1',
        tierUsed: 'http',
        costDollars: 0,
        licence: 'SYNTHETIC',
      },
      pageText,
      redactedText: pageText,
      caseTitle: spec.title,
      titleMasked: true,
      redactionVersion: v.redaction,
      sensitiveCategory: matrimonial ? 'matrimonial' : null,
      maskReason: matrimonial ? 'auto:matrimonial' : null,
      segmentVersion: v.segment,
      segmentedRedactionVersion: v.redaction,
      courtLevel: 'high_court',
      outcome: spec.outcome.outcome,
      outcomeAnchor: { page: 3, quote: decisionLine },
      enrichVersion: v.enrich,
      enrichedRedactionVersion: v.redaction,
      createdAt,
    });

    const page = (no: number) => pageText[no - 1]?.text ?? '';
    const segments: { role: DemoSegmentRow['role']; from: number; to: number; text: string }[] = [
      { role: 'header', from: 1, to: 1, text: page(1) },
      { role: 'facts', from: 2, to: 2, text: spec.pages[1]?.text.split('\n')[1] ?? '' },
      {
        role: 'issues',
        from: 2,
        to: 2,
        text: spec.pages[1]?.text.split('\n').slice(2).join('\n') ?? '',
      },
      {
        role: 'reasoning',
        from: 3,
        to: 3,
        text: spec.pages[2]?.text.split('\n').slice(1, 3).join('\n') ?? '',
      },
      { role: 'decision', from: 3, to: 3, text: decisionLine },
    ];
    segments.forEach((s, ordinal) => {
      rows.segments.push({
        id: demoId(ID_KIND.judgmentSegment, n * 10 + ordinal + 1),
        judgmentId: spec.id,
        ordinal,
        role: s.role,
        pageFrom: s.from,
        pageTo: s.to,
        text: s.text,
        court: spec.court,
        courtLevel: 'high_court',
        judgmentYear: spec.year,
      });
    });

    rows.tags.push(
      {
        id: demoId(ID_KIND.judgmentTag, n * 10 + 1),
        judgmentId: spec.id,
        subjectArea: spec.primary.area,
        confidence: 0.92,
        modelVersion: DEMO_TAG_MODEL_VERSION,
      },
      {
        id: demoId(ID_KIND.judgmentTag, n * 10 + 2),
        judgmentId: spec.id,
        subjectArea: spec.secondary.area,
        confidence: 0.64,
        modelVersion: DEMO_TAG_MODEL_VERSION,
      },
    );

    demoStatuteCites(spec).forEach((c, k) => {
      rows.statuteRefs.push({
        id: demoId(ID_KIND.judgmentStatuteRef, n * 10 + k + 1),
        judgmentId: spec.id,
        statute: c.statute,
        section: c.section,
        page: c.page,
        rulesetVersion: `enrich-${String(v.enrich)}`,
      });
    });

    // Each judgment cites two others of the corpus, found by their neutral citation.
    [1, 5].forEach((step, k) => {
      const cited = DEMO_JUDGMENTS[(spec.index + step) % DEMO_JUDGMENT_COUNT] as DemoJudgmentSpec;
      rows.citationRefs.push({
        id: demoId(ID_KIND.judgmentCitationRef, n * 10 + k + 1),
        judgmentId: spec.id,
        rawCitation: cited.citation,
        normalisedCitation: cited.citation,
        citedJudgmentId: cited.id,
        page: 3,
        rulesetVersion: `enrich-${String(v.enrich)}`,
      });
    });
  }
  return rows;
}

/** The judgments that cite `statute` section `section` (the primary or secondary section of the spec). */
export function demoJudgmentsCiting(
  statute: string,
  section: string,
): { judgmentId: string; page: number }[] {
  return DEMO_JUDGMENTS.flatMap((spec) =>
    demoStatuteCites(spec)
      .filter((c) => c.statute === statute && c.section === section)
      .map((c) => ({ judgmentId: spec.id, page: c.page })),
  );
}

/** Statute and section of a subject area, for the issue tags of the demo matters. */
export function demoAreaStatute(area: string): { statute: string; section: string } {
  const spec = AREAS.find((a) => a.area === area);
  if (spec === undefined) throw new RangeError(`demo corpus: unknown subject area ${area}`);
  return { statute: spec.statute, section: spec.section };
}
