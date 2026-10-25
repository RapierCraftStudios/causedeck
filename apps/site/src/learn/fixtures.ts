// Fictional examples for the lessons (#511). Modelled on the shape of the golden cause-list and
// order fixtures in core, but copied by hand: every name, number and date is invented, and every
// fixture carries `fictional: true`. Nothing here comes from a real matter.
export interface FictionalCauseList {
  id: 'cause-list-sample';
  fictional: true;
  court: string;
  date: string;
  items: { item: number; hall: string; caseNo: string; parties: string; advocate: string }[];
}

export interface FictionalOrder {
  id: 'order-sample';
  fictional: true;
  court: string;
  date: string;
  caseNo: string;
  direction: string;
  nextDate: string;
}

export const CAUSE_LIST_SAMPLE: FictionalCauseList = {
  id: 'cause-list-sample',
  fictional: true,
  court: 'Example High Court (fictional)',
  date: '2031-01-15',
  items: [
    {
      item: 1,
      hall: 'Court Hall 1',
      caseNo: 'WP 1001/2031',
      parties: 'Asha Example v. State of Exampleland',
      advocate: 'Adv. R. Sample',
    },
    {
      item: 2,
      hall: 'Court Hall 1',
      caseNo: 'CRP 2002/2031',
      parties: 'Demo Traders v. Sample Bank',
      advocate: 'Adv. K. Placeholder',
    },
    {
      item: 3,
      hall: 'Court Hall 2',
      caseNo: 'AS 3003/2031',
      parties: 'Mohan Fictional v. Test Housing Society',
      advocate: 'Adv. R. Sample',
    },
  ],
};

export const ORDER_SAMPLE: FictionalOrder = {
  id: 'order-sample',
  fictional: true,
  court: 'Example High Court (fictional)',
  date: '2031-01-15',
  caseNo: 'WP 1001/2031',
  direction: 'List after two weeks. Respondent to file a counter affidavit before the next date.',
  nextDate: '2031-01-29',
};

export const LEARN_FIXTURES = {
  'cause-list-sample': CAUSE_LIST_SAMPLE,
  'order-sample': ORDER_SAMPLE,
} as const;
export type LearnFixtureId = keyof typeof LEARN_FIXTURES;
