// The citations domain (#484, D-004): `verifyCitation` resolves a neutral citation against the raw
// judgments corpus, or marks it UNVERIFIED.
export { verifyCitation, type CitationAnchor, type CitationVerification } from './verify.ts';
// The corpus resolver (#1135): a `CitationResolver` over the corpus (neutral, case number, section,
// pinpoint and quote); `verifyPinpoint` checks a paragraph or page and a quote in the redacted text.
export { createCorpusResolver, type CorpusResolverOptions } from './corpus-resolver.ts';
export {
  verifyPinpoint,
  type PinpointCheck,
  type PinpointQuery,
  type PinpointStatus,
} from './verify-quote.ts';
