// Role accuracy of the segmenter (#893): per-role precision, recall and F1 over the labelled set, and
// their macro average. Paragraph level: every labelled paragraph is one observation.
import { SEGMENT_FIXTURES, type LabelledSegmentJudgment } from './segment-fixtures.ts';
import {
  classifyParagraphs,
  fullText,
  SEGMENT_ROLES,
  splitParagraphs,
  type SegmentRole,
} from './segment.ts';

export interface RoleScore {
  role: SegmentRole;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface SegmentEvaluation {
  judgments: number;
  paragraphs: number;
  perRole: RoleScore[];
  macroF1: number;
}

export function evaluateRoles(
  set: readonly LabelledSegmentJudgment[] = SEGMENT_FIXTURES,
): SegmentEvaluation {
  const tp = new Map<SegmentRole, number>();
  const fp = new Map<SegmentRole, number>();
  const fn = new Map<SegmentRole, number>();
  const bump = (m: Map<SegmentRole, number>, r: SegmentRole) => m.set(r, (m.get(r) ?? 0) + 1);
  let paragraphs = 0;
  for (const j of set) {
    const guesses = classifyParagraphs(splitParagraphs(fullText(j.pages)));
    if (guesses.length !== j.roles.length)
      throw new Error(
        `${j.id}: ${String(guesses.length)} paragraphs, ${String(j.roles.length)} labels`,
      );
    for (const [i, want] of j.roles.entries()) {
      const got = guesses[i]?.role ?? 'other';
      paragraphs += 1;
      if (got === want) bump(tp, want);
      else {
        bump(fp, got);
        bump(fn, want);
      }
    }
  }
  const perRole = SEGMENT_ROLES.map((role): RoleScore => {
    const t = tp.get(role) ?? 0;
    const p = t + (fp.get(role) ?? 0);
    const r = t + (fn.get(role) ?? 0);
    const precision = p === 0 ? 0 : t / p;
    const recall = r === 0 ? 0 : t / r;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { role, support: r, precision, recall, f1 };
  });
  // Roles absent from the labels (`other`) are not averaged.
  const scored = perRole.filter((s) => s.support > 0);
  const macroF1 = scored.reduce((a, s) => a + s.f1, 0) / scored.length;
  return { judgments: set.length, paragraphs, perRole, macroF1 };
}
