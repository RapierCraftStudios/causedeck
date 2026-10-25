// eCourts district-court case status page (#590): "Case Details" and "Case Status" label/value
// tables plus the "Orders" table. Pure; shared by the device and server paths.
import { readStatusPage, type PageSpec } from './html.ts';
import type { ParsedCaseStatus } from './types.ts';

const SPEC: PageSpec = {
  template: 'ecourts-district',
  labels: {
    cnr: /^cnr( number| no\.?)?$/,
    caseNumber: /^(registration number|registration no\.?|case number)$/,
    nextHearingDate: /^next hearing date$/,
    lastHearingDate: /^(first hearing date|last hearing date|decision date)$/,
    stage: /^(case stage|stage of case)$/,
    bench: /^(court number and judge|court and judge|judge)$/,
  },
  orderColumns: { date: /^order date$/, number: /^order number$/, summary: /^order details$/ },
};

export function parseEcourtsDistrictStatus(html: string): ParsedCaseStatus {
  return readStatusPage(html, SPEC);
}
