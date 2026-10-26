// Consistency checker schemas (#78, DR-3): a finding says where in a draft a mention disagrees with
// the matter graph, what the graph says and where that fact came from. The checker proposes nothing:
// `fix` is only the replacement a lawyer may confirm (L2), never applied automatically. Report
// content is privileged matter data.
import { z } from 'zod';

export const FINDING_SEVERITIES = ['error', 'warn', 'info'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const CONSISTENCY_RULES = [
  'name.mismatch',
  'case_number.mismatch',
  'date.order_mismatch',
  'date.listing_mismatch',
  'annexure.missing',
  'annexure.duplicate',
  'annexure.gap',
  'annexure.unreferenced',
] as const;
export type ConsistencyRule = (typeof CONSISTENCY_RULES)[number];

/** Where in the draft: a block key and a character range in that block's text. */
export const SpanSchema = z
  .object({
    blockKey: z.string().min(1).max(200),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .strict()
  .refine((s) => s.end >= s.start, { message: 'end before start' });
export type Span = z.infer<typeof SpanSchema>;

/** The graph fact a finding compares against: what it is and its source type and anchor. */
export const FindingProvenanceSchema = z
  .object({
    fact: z.string().min(1).max(100),
    sourceType: z.string().min(1).max(50),
    sourceRef: z.string().max(500).nullable(),
    anchorId: z.string().max(100).nullable(),
  })
  .strict();
export type FindingProvenance = z.infer<typeof FindingProvenanceSchema>;

export const FindingSchema = z
  .object({
    id: z.string().min(1).max(300),
    severity: z.enum(FINDING_SEVERITIES),
    rule: z.enum(CONSISTENCY_RULES),
    span: SpanSchema,
    /** What the graph says. */
    expected: z.string().max(2000),
    /** What the draft says. */
    found: z.string().max(2000),
    provenance: FindingProvenanceSchema,
    /** The edit a lawyer may confirm: replace the span with this text. Absent when none is safe. */
    fix: z.object({ replacement: z.string().max(2000) }).strict().exactOptional(),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

export const FindingCountsSchema = z
  .object({
    error: z.number().int().min(0),
    warn: z.number().int().min(0),
    info: z.number().int().min(0),
  })
  .strict();
export type FindingCounts = z.infer<typeof FindingCountsSchema>;

export const ConsistencyReportSchema = z
  .object({
    draftVersionId: z.uuid(),
    graphRevision: z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase sha256 hex digest'),
    findings: z.array(FindingSchema),
    counts: FindingCountsSchema,
  })
  .strict();
export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

/** The job payload of `drafting.consistency.check`. */
export const ConsistencyCheckRequestSchema = z
  .object({ workspaceId: z.uuid(), draftVersionId: z.uuid() })
  .strict();
export type ConsistencyCheckRequest = z.infer<typeof ConsistencyCheckRequestSchema>;

/** `applyFix` needs the literal `confirm: true`; there is no other way to change a draft. */
export const ApplyFixRequestSchema = z
  .object({
    draftVersionId: z.uuid(),
    findingId: z.string().min(1).max(300),
    confirm: z.literal(true),
  })
  .strict();
export type ApplyFixRequest = z.infer<typeof ApplyFixRequestSchema>;
