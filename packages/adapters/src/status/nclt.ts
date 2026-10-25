// NCLT case status result page (#662): a label/value table and an orders table.
import { readStatusPage, type PageSpec } from './html.ts';
import type { ParsedCaseStatus } from './types.ts';

const SPEC: PageSpec = {
  template: 'nclt',
  labels: {
    cnr: /^(cnr( number| no\.?)?|filing (number|no\.?))$/,
    caseNumber: /^(case number|case no\.?|cp no\.?|case type and number)$/,
    nextHearingDate: /^(next hearing date|next date of hearing|next date|next listing date)$/,
    lastHearingDate: /^(last hearing date|previous hearing date|date of last hearing)$/,
    stage: /^(stage|stage of case|case status|status)$/,
    bench: /^(bench|court|court hall|coram)$/,
  },
  orderColumns: {
    date: /^(order date|date of order)$/,
    number: /^(sl\.? ?no\.?|order no\.?)$/,
    summary: /^(order|order details|remarks)$/,
  },
};

export function parseNcltStatus(html: string): ParsedCaseStatus {
  return readStatusPage(html, SPEC);
}
