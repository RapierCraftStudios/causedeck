// The extraction domain (#46; PRD DI-3): `runOrderExtraction`, the body of the
// `extraction.extract-order` job. It reads a processed order or judgment, runs anchored extraction
// (`@causedeck/intelligence`), stores the result and its rejections (superseding, never deleting),
// stages proposals through the automation engine and routes a capture that needs a person to
// "Needs you". Not re-exported from the package root.
export {
  runOrderExtraction,
  type ExtractionDeps,
  type ExtractionOutcome,
  type ExtractionPayload,
} from './run.ts';
