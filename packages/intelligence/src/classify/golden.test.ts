import { describe, expect, it } from 'vitest';

import type { DocumentKind } from '@causedeck/db/schema';

import { classifyDocument, type LlmClassifier } from './index.ts';

const BENCH = "PRESENT: HON'BLE MR. JUSTICE A. SAMPLE";
const COURT = 'IN THE HIGH COURT OF JUDICATURE AT FICTIONALPUR';

type Sample = [DocumentKind, string];

const rows = (n: number): string =>
  Array.from(
    { length: n },
    (_, i) => `${String(i + 1)}. W.P. No. ${String(100 + i)}/2024 Sample v. State`,
  ).join('\n');

const SAMPLES: Sample[] = [
  ['order', `${COURT}\n${BENCH}\nORDER\nHeard learned counsel. List after two weeks.`],
  ['order', `${COURT}\n${BENCH}\nORDER\nThe application is allowed in part.`],
  ['order', `${COURT}\nORDER SHEET\nBefore HON'BLE MS. JUSTICE B. EXAMPLE\nPosted to 12.03.2025.`],
  ['order', `${BENCH}\nHeard. Interim stay extended.`],
  ['order', `${COURT}\n${BENCH}\nஆணை\nவிசாரணை நடைபெற்றது.`],
  ['order', 'ಮಾನ್ಯ ನ್ಯಾಯಮೂರ್ತಿ ಸಿ. ಮಾದರಿ ಅವರ ಮುಂದೆ\nಆದೇಶ\nಅರ್ಜಿಯ ವಿಚಾರಣೆ ನಡೆಯಿತು.'],
  [
    'order',
    `${COURT}\n${BENCH}\nORDER\nPetition against the notice dated 04.01.2025 is disposed of.`,
  ],
  [
    'order',
    `${COURT}\nHON'BLE MR. JUSTICE A. SAMPLE\nORDER\nNo representation for the respondent.`,
  ],
  ['judgment', `${COURT}\n${BENCH}\nJUDGMENT\nThis appeal is allowed for the reasons below.`],
  ['judgment', `${COURT}\nBefore HON'BLE MR. JUSTICE A. SAMPLE\nJUDGMENT\nThe suit is decreed.`],
  [
    'judgment',
    `${COURT}\nCORAM: HON'BLE MS. JUSTICE B. EXAMPLE\nCOMMON JUDGMENT\nBoth appeals are dismissed.`,
  ],
  ['judgment', `${COURT}\n${BENCH}\nJUDGEMENT\nThe revision is dismissed with costs.`],
  ['judgment', `${COURT}\n${BENCH}\nதீர்ப்பு\nமேல்முறையீடு தள்ளுபடி.`],
  ['cause_list', `CAUSE LIST FOR 12.03.2025\nCOURT HALL 7\n${rows(6)}`],
  ['cause_list', `${COURT}\nADVANCE LIST\n${rows(5)}`],
  ['cause_list', `LIST OF BUSINESS FOR TUESDAY\n${rows(4)}`],
  ['cause_list', `DAILY LIST\nCourt No. 3\n${rows(8)}`],
  ['cause_list', `SUPPLEMENTARY LIST\n${rows(3)}`],
  ['registry_memo', 'REGISTRY\nOFFICE NOTE\nThe following objections are raised in the filing.'],
  ['registry_memo', 'OFFICE OBJECTION MEMO\nREGISTRAR (JUDICIAL)\nDefects noted in the appeal.'],
  ['registry_memo', 'REGISTRY MEMO\nOffice report on the compliance of objections.'],
  ['registry_memo', 'OFFICE REPORT\nRegistry note: defects in the vakalatnama.'],
  ['ia', 'INTERLOCUTORY APPLICATION NO. 5 OF 2025\nFor extension of time to file the counter.'],
  ['ia', 'I.A. No. 12 of 2025 in W.P. No. 4821/2024\nFor interim directions.'],
  ['ia', 'MISCELLANEOUS PETITION NO. 9 OF 2025\nFor condonation of delay.'],
  ['ia', 'APPLICATION UNDER ORDER 39 RULES 1 AND 2\nFor temporary injunction.'],
  [
    'pleading',
    'WRIT PETITION\nThe petitioner most respectfully shewETH as follows.\nGROUNDS\nPRAYER\nIt is therefore prayed that this Court quash the notice.',
  ],
  [
    'pleading',
    'COUNTER AFFIDAVIT\nI, the respondent, state as follows.\nAFFIDAVIT verified at Fictionalpur.',
  ],
  ['pleading', 'WRITTEN STATEMENT\nThe defendant denies the plaint.\nGROUNDS of defence follow.'],
  ['pleading', 'PLAINT\nThe plaintiff seeks relief.\nPRAYER\nDecree for possession.'],
  ['annexure', 'ANNEXURE P-3\nCopy of the notice dated 04.01.2025 issued by the department.'],
  ['annexure', 'ANNEXURE-R2\nSample sale deed extract.'],
  ['annexure', 'EXHIBIT A-4\nPhotograph of the boundary wall.'],
  ['annexure', 'ANNEXURE A\nRent receipt for March.'],
  [
    'correspondence',
    'To,\nThe Registrar,\nSubject: Request for certified copy\nDear Sir,\nKindly issue the copy.\nYours faithfully,\nAsha Vellore',
  ],
  [
    'correspondence',
    'Dear Madam,\nSub: Hearing date\nRef: W.P. 4821/2024\nYours sincerely,\nCounsel',
  ],
  [
    'correspondence',
    'SUBJECT: Follow up on the notice\nDear Sir,\nPlease confirm receipt.\nRegards,\nSample Associates',
  ],
  ['other', 'Grocery list: rice, dal, onions, tea.'],
  ['other', 'Photo of the courtyard taken at noon.'],
  ['other', 'Reminder to call the clerk tomorrow about the stamp.'],
  ['other', 'Draft idea for the weekend trip.'],
];

describe('classification golden set (synthetic)', () => {
  it('is at least 95% accurate with at most 20% model calls', async () => {
    let correct = 0;
    let llmCalls = 0;
    const llm: LlmClassifier = {
      classify() {
        llmCalls += 1;
        return Promise.resolve({ kind: 'other', confidence: 0.7 });
      },
    };
    for (const [expected, text] of SAMPLES) {
      const result = await classifyDocument(text, { llm, pageCount: 1 });
      if (result.kind === expected) correct += 1;
    }
    expect(correct / SAMPLES.length).toBeGreaterThanOrEqual(0.95);
    expect(llmCalls / SAMPLES.length).toBeLessThanOrEqual(0.2);
  });

  it('answers from rules alone when no model is allowed (ai_blocked or sensitive)', async () => {
    const result = await classifyDocument('Grocery list: rice, dal', { llm: null, pageCount: 1 });
    expect(result).toMatchObject({ kind: 'other', source: 'rules', llmCalled: false });
  });

  it('does not call the model when a rule scores 0.8 or more', async () => {
    const llm: LlmClassifier = {
      classify: () => Promise.reject(new Error('model must not be called')),
    };
    const result = await classifyDocument(`${COURT}\n${BENCH}\nORDER\nList after two weeks.`, {
      llm,
      pageCount: 1,
    });
    expect(result.kind).toBe('order');
    expect(result.llmCalled).toBe(false);
  });
});
