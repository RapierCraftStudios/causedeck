// The stale-matter attention domain (#70): `detectAttention` (rule-based, explainable flags that
// never change data or send anything), snooze, dismiss and lift by a person with an audit entry,
// the per-workspace threshold and the nightly scan's counts. Other domains import this file only.
export {
  countAttention,
  detectAttention,
  scanWorkspaceAttention,
  type AttentionActor,
  type AttentionDeps,
} from './detect.ts';
export {
  evaluateRules,
  HEARING_WINDOW_DAYS,
  noNextDate,
  noRecentUpdate,
  obligationOverdueUnowned,
  pastDateNoOutcome,
  type MatterFacts,
  type RuleContext,
  type RuleHit,
} from './rules.ts';
export {
  dismissFlag,
  liftSnooze,
  listSnoozes,
  setStaleDays,
  snoozeFlag,
} from './snooze.ts';
