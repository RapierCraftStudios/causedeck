// Madras High Court case status result page (#590): a label/value table and an orders table.
import { readStatusPage, type PageSpec } from './html.ts';
import type { ParsedCaseStatus } from './types.ts';

const SPEC: PageSpec = {
  template: 'madras-hc',
  labels: {
    cnr: /^cnr( number| no\.?)?$/,
    caseNumber: /^(case number|case no\.?|main case number)$/,
    nextHearingDate: /^(next date|next listing date|next hearing date)$/,
    lastHearingDate: /^(last listed on|last hearing date|date of last hearing)$/,
    stage: /^(present status|stage|case status)$/,
    bench: /^(bench|court hall|court hall \/ judges?|judges?)$/,
  },
  orderColumns: {
    date: /^(date|order date)$/,
    number: /^(order no\.?|s\.?no\.?)$/,
    summary: /^(order type|order|judge)$/,
  },
};

export function parseMadrasHcStatus(html: string): ParsedCaseStatus {
  return readStatusPage(html, SPEC);
}
