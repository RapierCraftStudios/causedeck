// Brief readiness (#60): a pure 0-100 score over four segments (25 each) with one human-readable
// reason per missing segment.
import type { Brief, Readiness } from '@causedeck/validators';

const CONFIRMED = new Set(['confirmed', 'auto_applied', 'corrected']);

export function computeReadiness(brief: Brief): Readiness {
  const stageKnown = brief.stage !== null && brief.stage.text.trim().length > 0;
  const lastOrderConfirmed =
    brief.last_order.length > 0 &&
    brief.last_order.every((l) => CONFIRMED.has(l.confirmation_state));
  const reconciled = brief.obligations.open.every((o) => !o.overdue && o.owner_member_id !== null);
  const segments = {
    stage_known: stageKnown,
    last_order_confirmed: lastOrderConfirmed,
    obligations_reconciled: reconciled,
    carry_reviewed: brief.carry_reviewed,
  };
  const reasons: Readiness['reasons'] = [];
  if (!stageKnown) reasons.push({ segment: 'stage_known', reason: 'The stage is not known' });
  if (!lastOrderConfirmed) {
    reasons.push({
      segment: 'last_order_confirmed',
      reason:
        brief.last_order.length === 0
          ? 'No order is on file for this proceeding'
          : 'The last order is not confirmed',
    });
  }
  if (!reconciled) {
    const overdue = brief.obligations.open.filter((o) => o.overdue).length;
    reasons.push({
      segment: 'obligations_reconciled',
      reason:
        overdue > 0
          ? `${overdue} open obligation${overdue === 1 ? ' is' : 's are'} overdue`
          : 'An open obligation has no owner',
    });
  }
  if (!segments.carry_reviewed) {
    reasons.push({ segment: 'carry_reviewed', reason: 'The carry list has not been reviewed' });
  }
  const score = Object.values(segments).filter(Boolean).length * 25;
  return { score, segments, reasons };
}
