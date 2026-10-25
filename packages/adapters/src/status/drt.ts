// DRT and DRAT case status result page (#662): a label/value table and an orders table.
import { readStatusPage, type PageSpec } from './html.ts';
import type { ParsedCaseStatus } from './types.ts';

const SPEC: PageSpec = {
  template: 'drt',
  labels: {
    cnr: /^(cnr( number| no\.?)?|diary (number|no\.?))$/,
    caseNumber: /^(case number|case no\.?|oa number|oa no\.?|appeal number)$/,
    nextHearingDate: /^(next hearing date|next date of hearing|next date)$/,
    lastHearingDate: /^(last hearing date|previous hearing date|date of last hearing)$/,
    stage: /^(stage|stage of case|case stage|status)$/,
    bench: /^(tribunal|court|bench|presiding officer|recovery officer)$/,
  },
  orderColumns: {
    date: /^(order date|date of order)$/,
    number: /^(sl\.? ?no\.?|order no\.?)$/,
    summary: /^(order|order details|remarks)$/,
  },
};

export function parseDrtStatus(html: string): ParsedCaseStatus {
  return readStatusPage(html, SPEC);
}
