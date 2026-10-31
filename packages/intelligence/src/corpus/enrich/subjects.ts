// Subject areas of a judgment (#894, ADR 0051 §Enrichment): a controlled vocabulary assigned through
// the AI gateway. The gateway is a port (this package imports none), its reply is schema-validated,
// anything outside the vocabulary or below the confidence floor is dropped, and an unusable reply
// yields no tags at all: an area is never guessed.
import { z } from 'zod';

// Ordered most common first: the macro-F1 target is scored on the first 15.
export const SUBJECT_AREAS = [
  'medical_negligence',
  'consumer',
  'rent_control',
  'motor_accident_claims',
  'ndps',
  'bail',
  'arbitration',
  'ibc',
  'service',
  'criminal_appeal',
  'cheque_dishonour',
  'land_acquisition',
  'family_matrimonial',
  'property_title',
  'tax',
  'labour_industrial',
  'constitutional_writ',
  'company',
  'intellectual_property',
  'environment',
] as const;
export type SubjectArea = (typeof SUBJECT_AREAS)[number];

/** Tags below this confidence are dropped. */
export const SUBJECT_MIN_CONFIDENCE = 0.5;
/** Areas kept per judgment. */
export const SUBJECT_MAX_TAGS = 3;
/** Characters of redacted text sent to the model. */
export const SUBJECT_TEXT_CHARS = 8000;

export const subjectReplySchema = z.object({
  tags: z.array(z.object({ area: z.string(), confidence: z.number().min(0).max(1) })).max(20),
});

/** Classifies a judgment's text into the vocabulary; its `version` names the model and prompt. */
export interface SubjectResolver {
  readonly version: string;
  classify(input: { text: string; areas: readonly SubjectArea[] }): Promise<unknown>;
}

export interface SubjectTag {
  area: SubjectArea;
  confidence: number;
}

const KNOWN = new Set<string>(SUBJECT_AREAS);

/** The tags the resolver assigns to `text`, or null when it returned nothing usable. */
export async function tagSubjects(
  text: string,
  resolver: SubjectResolver,
): Promise<SubjectTag[] | null> {
  const reply = subjectReplySchema.safeParse(
    await resolver.classify({ text: text.slice(0, SUBJECT_TEXT_CHARS), areas: SUBJECT_AREAS }),
  );
  if (!reply.success) return null;
  const best = new Map<SubjectArea, number>();
  for (const tag of reply.data.tags) {
    if (!KNOWN.has(tag.area) || tag.confidence < SUBJECT_MIN_CONFIDENCE) continue;
    const area = tag.area as SubjectArea;
    best.set(area, Math.max(best.get(area) ?? 0, tag.confidence));
  }
  return [...best.entries()]
    .map(([area, confidence]) => ({ area, confidence }))
    .sort((a, b) => b.confidence - a.confidence || a.area.localeCompare(b.area))
    .slice(0, SUBJECT_MAX_TAGS);
}
