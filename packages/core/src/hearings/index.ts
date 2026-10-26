// The hearings domain (#62): the hearing outcome confirmation (PRD EX-3). Other domains are
// imported only through their index.ts. See docs/engineering/core-domains.md.
export {
  confirmOutcome,
  getOutcomeProposal,
  recordManualOutcome,
  type ConfirmedOutcome,
  type HearingActor,
  type HearingDeps,
  type HearingEvent,
  type HearingEvents,
  type HearingOutcomeConfirmedEvent,
} from './outcome.ts';
