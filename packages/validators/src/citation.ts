// Citation checker schemas (#77, DR-2). A citation found in a draft is `verified`, `not_found` or
// `unknown` (the UI shows a check, a cross and a question mark). Only the citation string, the
// status, a canonical URL and a short title are ever stored: never judgment text. The lists are
// closed so a status or reason outside them is rejected at the edge. A pinpoint (`para 12`,
// `paras 12-14`, `at p. 7`) and the status of a quote check may ride along (#1117); the quoted
// text itself is used only to verify and is never part of a citation or report.
import { z } from 'zod';

export const CITATION_STATUSES = ['verified', 'not_found', 'unknown'] as const;
export const CitationStatus = z.enum(CITATION_STATUSES);
export type CitationStatus = z.infer<typeof CitationStatus>;

export const CITATION_KINDS = [
  'neutral',
  'reporter',
  'case_name',
  'case_number',
  'section',
] as const;
export const CitationKind = z.enum(CITATION_KINDS);
export type CitationKind = z.infer<typeof CitationKind>;

/**
 * Why a citation is not `verified`. `resolver_unavailable` and `throttled` are retried later.
 * `quote_not_found` (the paragraph or page exists but the quote is not in it) and
 * `pinpoint_not_found` (no such paragraph or page) come from the quote/pinpoint check;
 * `section_not_found` is a statute section citation with no matching section.
 */
export const CITATION_REASONS = [
  'resolver_unavailable',
  'throttled',
  'ambiguous',
  'title_mismatch',
  'title_missing',
  'unsupported',
  'quote_not_found',
  'pinpoint_not_found',
  'section_not_found',
] as const;
export const CitationReason = z.enum(CITATION_REASONS);
export type CitationReason = z.infer<typeof CitationReason>;

/** Outcome of checking a quoted passage against the stored judgment; absent means not checked. */
export const CITATION_QUOTE_CHECKS = ['verified', 'not_found'] as const;
export const CitationQuoteCheck = z.enum(CITATION_QUOTE_CHECKS);
export type CitationQuoteCheck = z.infer<typeof CitationQuoteCheck>;

/** Where in the cited judgment: `para 12`, `paras 12-14` (`paraEnd`), `at p. 7` (`page`). */
export const CitationPinpointSchema = z
  .object({
    para: z.number().int().min(1).optional(),
    paraEnd: z.number().int().min(1).optional(),
    page: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((p) => p.para !== undefined || p.paraEnd !== undefined || p.page !== undefined, {
    message: 'A pinpoint names a paragraph or a page.',
  })
  .refine((p) => p.paraEnd === undefined || p.para === undefined || p.paraEnd >= p.para, {
    message: 'A paragraph range ends at or after its start.',
    path: ['paraEnd'],
  });
export type CitationPinpoint = z.infer<typeof CitationPinpointSchema>;

/** Longest short title kept with a citation. */
export const CITATION_TITLE_MAX = 200;

export const CitationSchema = z
  .object({
    id: z.string().min(1),
    blockId: z.string().min(1),
    span: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    raw: z.string().min(1).max(300),
    normalized: z.string().min(1).max(300),
    kind: CitationKind,
    status: CitationStatus,
    sourceUrl: z.url().optional(),
    /** The stored judgment the source URL belongs to, when known: opens the in-app reader (#1191). */
    judgmentId: z.uuid().optional(),
    title: z.string().max(CITATION_TITLE_MAX).optional(),
    reason: CitationReason.optional(),
    pinpoint: CitationPinpointSchema.optional(),
    quoteChecked: CitationQuoteCheck.optional(),
  })
  .strict();
export type Citation = z.infer<typeof CitationSchema>;

export const CitationReportSchema = z
  .object({
    draftVersionId: z.string().min(1),
    items: z.array(CitationSchema),
    counts: z
      .object({
        verified: z.number().int().min(0),
        not_found: z.number().int().min(0),
        unknown: z.number().int().min(0),
      })
      .strict(),
    /** Citations left `unknown` because the rate limit or daily budget was reached. */
    throttled: z.number().int().min(0),
  })
  .strict();
export type CitationReport = z.infer<typeof CitationReportSchema>;

export const AcknowledgeUnverifiedInput = z
  .object({
    draftVersionId: z.uuid(),
    citationIds: z.array(z.uuid()).min(1).max(200),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type AcknowledgeUnverifiedInput = z.infer<typeof AcknowledgeUnverifiedInput>;
