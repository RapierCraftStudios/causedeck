// Parsed case status (#590, part 2 of #483): the one shape the three status-page parsers return,
// shared by the on-device and the server paths. Every value that was read from the page has the
// verbatim cell text it came from in `quotes`, so a status diff can show its provenance.
import { z } from 'zod';

export const CASE_STATUS_TEMPLATES = [
  'ecourts-district',
  'madras-hc',
  'karnataka-hc',
  'drt',
  'nclt',
] as const;
export type CaseStatusTemplate = (typeof CASE_STATUS_TEMPLATES)[number];

export const CASE_STATUS_RESULTS = ['ok', 'not_found', 'unrecognised'] as const;

export const CaseStatusOrderSchema = z.object({
  /** ISO calendar date of the order, null when the page prints none that parses. */
  date: z.string().nullable(),
  number: z.string().nullable(),
  summary: z.string().nullable(),
  href: z.string().nullable(),
});
export type CaseStatusOrder = z.infer<typeof CaseStatusOrderSchema>;

export const ParsedCaseStatusSchema = z.object({
  template: z.enum(CASE_STATUS_TEMPLATES),
  status: z.enum(CASE_STATUS_RESULTS),
  cnr: z.string().nullable(),
  caseNumber: z.string().nullable(),
  /** ISO calendar dates. */
  nextHearingDate: z.string().nullable(),
  lastHearingDate: z.string().nullable(),
  stage: z.object({ raw: z.string(), norm: z.string().nullable() }).nullable(),
  bench: z.string().nullable(),
  orders: z.array(CaseStatusOrderSchema),
  /** Verbatim page text each scalar field was read from, keyed by field name. */
  quotes: z.record(z.string(), z.string()),
});
export type ParsedCaseStatus = z.infer<typeof ParsedCaseStatusSchema>;
