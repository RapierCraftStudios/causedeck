// Fact-check service inputs (#914, part 2 of #170). A claim is named by its canonical key
// (`<kind>:<value>`, as the engine in `@causedeck/drafting` derives it), never by draft text. The
// export acknowledgement needs the literal `confirm: true` and a typed reason, as the citation one does.
import { z } from 'zod';

export const FACT_CLAIM_KEY_MAX = 300;

export const FactClaimKey = z.string().trim().min(3).max(FACT_CLAIM_KEY_MAX);

const VersionInput = z.object({ draftVersionId: z.uuid() });

export const FactCheckRunInput = VersionInput.strict();
export type FactCheckRunInput = z.infer<typeof FactCheckRunInput>;

/** Ignore one claim for the draft's matter, or stand behind it as the author's own assertion. */
export const FactClaimDecisionInput = VersionInput.extend({ claimKey: FactClaimKey }).strict();
export type FactClaimDecisionInput = z.infer<typeof FactClaimDecisionInput>;

export const AcknowledgeFactCheckInput = VersionInput.extend({
  reason: z.string().trim().min(3).max(500),
  confirm: z.literal(true),
}).strict();
export type AcknowledgeFactCheckInput = z.infer<typeof AcknowledgeFactCheckInput>;

export const RecordFactFixInput = z
  .object({ fromVersionId: z.uuid(), toVersionId: z.uuid() })
  .strict();
export type RecordFactFixInput = z.infer<typeof RecordFactFixInput>;
