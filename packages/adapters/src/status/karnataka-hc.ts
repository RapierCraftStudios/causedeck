// Karnataka High Court case status result page (#590): a label/value table and an orders table.
import { readStatusPage, type PageSpec } from './html.ts';
import type { ParsedCaseStatus } from './types.ts';

const SPEC: PageSpec = {
  template: 'karnataka-hc',
  labels: {
    cnr: /^cnr( number| no\.?)?$/,
    caseNumber: /^(case no\.?|case number|case)$/,
    nextHearingDate: /^(next hearing date|next date of hearing|next date)$/,
    lastHearingDate: /^(last hearing date|previous hearing date|date of last hearing)$/,
    stage: /^(stage of case|stage|status)$/,
    bench: /^(bench|court hall|court|before)$/,
  },
  orderColumns: {
    date: /^(order date|date of order)$/,
    number: /^(sl\.? ?no\.?|order no\.?)$/,
    summary: /^(order|order details|remarks)$/,
  },
};

export function parseKarnatakaHcStatus(html: string): ParsedCaseStatus {
  return readStatusPage(html, SPEC);
}
