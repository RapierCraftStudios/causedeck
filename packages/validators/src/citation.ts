// Citation checker schemas (#77, DR-2). A citation found in a draft is `verified`, `not_found` or
// `unknown` (the UI shows a check, a cross and a question mark). Only the citation string, the
// status, a canonical URL and a short title are ever stored: never judgment text. The lists are
// closed so a status or reason outside them is rejected at the edge.
import { z } from 'zod';

export const CITATION_STATUSES = ['verified', 'not_found', 'unknown'] as const;
export const CitationStatus = z.enum(CITATION_STATUSES);
export type CitationStatus = z.infer<typeof CitationStatus>;

export const CITATION_KINDS = ['neutral', 'reporter', 'case_name'] as const;
export const CitationKind = z.enum(CITATION_KINDS);
export type CitationKind = z.infer<typeof CitationKind>;

/** Why a citation is `unknown`. `resolver_unavailable` and `throttled` are retried later. */
export const CITATION_REASONS = [
  'resolver_unavailable',
  'throttled',
  'ambiguous',
  'title_mismatch',
  'title_missing',
  'unsupported',
] as const;
export const CitationReason = z.enum(CITATION_REASONS);
export type CitationReason = z.infer<typeof CitationReason>;

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
    title: z.string().max(CITATION_TITLE_MAX).optional(),
    reason: CitationReason.optional(),
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
