// The confirm grid's edit model (#57 part 5, #551): the stored plan's proceedings regrouped into
// matters. Rename, merge, split and move only change the grouping (the server rebuilds the matters
// from the stored proceedings, `regroupPlan` in core), so these are pure functions over the groups.
// `previewMatters` derives what each row shows; `confirmImport` saves the edits, then applies the
// plan with the decisions mapped onto the saved matters.
import type { ApplyDecisions, ImportPlan, PlanIssue, PlanMatter } from '@causedeck/core/import';

import type { Result } from '../safe-action.ts';

export interface EditGroup {
  tempId: string;
  title: string;
  proceedingKeys: string[];
}

export const groupsOf = (plan: ImportPlan): EditGroup[] =>
  plan.matters.map((m) => ({
    tempId: m.tempId,
    title: m.title,
    proceedingKeys: m.proceedings.map((p) => p.key),
  }));

/** One stable id for a set of proceedings: how a matter is found again after the server saved it. */
export const keysetOf = (keys: readonly string[]): string => [...keys].sort().join('\n');

export const renameGroup = (groups: EditGroup[], tempId: string, title: string): EditGroup[] =>
  groups.map((g) => (g.tempId === tempId ? { ...g, title } : g));

/** `fromId` joins `intoId`: its proceedings move over and its row goes. */
export function mergeGroups(groups: EditGroup[], intoId: string, fromId: string): EditGroup[] {
  const from = groups.find((g) => g.tempId === fromId);
  if (from === undefined || intoId === fromId) return groups;
  return groups
    .filter((g) => g.tempId !== fromId)
    .map((g) =>
      g.tempId === intoId
        ? { ...g, proceedingKeys: [...g.proceedingKeys, ...from.proceedingKeys] }
        : g,
    );
}

/** A proceeding becomes a matter of its own, placed right after the matter it left. */
export function splitProceeding(groups: EditGroup[], key: string, title: string): EditGroup[] {
  const source = groups.find((g) => g.proceedingKeys.includes(key));
  if (source === undefined || source.proceedingKeys.length < 2) return groups;
  const out: EditGroup[] = [];
  for (const g of groups) {
    if (g !== source) {
      out.push(g);
      continue;
    }
    out.push({ ...g, proceedingKeys: g.proceedingKeys.filter((k) => k !== key) });
    out.push({ tempId: `new_${key}`.slice(0, 40), title, proceedingKeys: [key] });
  }
  return out;
}

/** A proceeding moves to another matter; a matter left without proceedings goes. */
export function moveProceeding(groups: EditGroup[], key: string, toId: string): EditGroup[] {
  const source = groups.find((g) => g.proceedingKeys.includes(key));
  if (source === undefined || source.tempId === toId || !groups.some((g) => g.tempId === toId)) {
    return groups;
  }
  return groups
    .map((g) => {
      if (g.tempId === source.tempId) {
        return { ...g, proceedingKeys: g.proceedingKeys.filter((k) => k !== key) };
      }
      return g.tempId === toId ? { ...g, proceedingKeys: [...g.proceedingKeys, key] } : g;
    })
    .filter((g) => g.proceedingKeys.length > 0);
}

export interface PreviewMatter extends PlanMatter {
  /** The grouping this row stands for. */
  keyset: string;
  /** Blocking issues the lawyer has not picked a date for yet. */
  open: PlanIssue[];
}

/** The date a proceeding shows: the picked one, else its single source-of-truth date. */
const dateOf = (resolved: Readonly<Record<string, string>>, p: PlanMatter['proceedings'][number]) =>
  resolved[p.key] ?? p.nextDate?.date ?? null;

/** The rows for `groups`: derived like the server derives them, sorted by next date, none last. */
export function previewMatters(
  plan: ImportPlan,
  groups: readonly EditGroup[],
  resolved: Readonly<Record<string, string>> = {},
): PreviewMatter[] {
  const byKey = new Map<string, { p: PlanMatter['proceedings'][number]; from: PlanMatter }>();
  for (const m of plan.matters) for (const p of m.proceedings) byKey.set(p.key, { p, from: m });
  const rows = groups.map((g): PreviewMatter => {
    const entries = g.proceedingKeys.flatMap((k) => byKey.get(k) ?? []);
    const proceedings = entries.map((e) => e.p);
    const origins = [...new Set(entries.map((e) => e.from))];
    const issues: PlanIssue[] = proceedings.flatMap((p) =>
      p.nextDateCandidates.length > 1
        ? [
            {
              code: 'conflicting_dates' as const,
              blocking: true,
              proceedingKey: p.key,
              dates: p.nextDateCandidates.map((d) => d.date),
            },
          ]
        : [],
    );
    if (origins.some((o) => o.issues.some((i) => i.code === 'low_confidence'))) {
      issues.push({ code: 'low_confidence', blocking: false });
    }
    const dates = proceedings.flatMap((p) => dateOf(resolved, p) ?? []).sort();
    const first = dates[0];
    const picked =
      first === undefined ? undefined : proceedings.find((p) => dateOf(resolved, p) === first);
    return {
      tempId: g.tempId,
      title: g.title,
      proceedings,
      nextDate:
        first === undefined
          ? null
          : (picked?.nextDate ??
            picked?.nextDateCandidates.find((d) => d.date === first) ?? {
              date: first,
              sources: [],
            }),
      issues,
      confidence: origins.length === 0 ? 0 : Math.min(...origins.map((o) => o.confidence)),
      reason: '',
      sources: proceedings.flatMap((p) => p.sources),
      keyset: keysetOf(g.proceedingKeys),
      open: issues.filter(
        (i) =>
          i.blocking && (i.proceedingKey === undefined || resolved[i.proceedingKey] === undefined),
      ),
    };
  });
  const rank = (m: PreviewMatter) => m.nextDate?.date ?? '9999-99-99';
  return rows.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
}

/** Decisions for the saved plan: skipped matters found again by their proceedings. */
export function decisionsFor(
  saved: ImportPlan,
  excluded: ReadonlySet<string>,
  resolvedDates: Readonly<Record<string, string>>,
): ApplyDecisions {
  const matters: NonNullable<ApplyDecisions['matters']> = {};
  for (const m of saved.matters) {
    if (excluded.has(keysetOf(m.proceedings.map((p) => p.key))))
      matters[m.tempId] = { action: 'skip' };
  }
  return {
    matters,
    ...(Object.keys(resolvedDates).length === 0 ? {} : { resolvedDates: { ...resolvedDates } }),
  };
}

export interface ConfirmInput {
  groups: EditGroup[];
  /** True when the grouping differs from the stored plan: it is saved first. */
  dirty: boolean;
  /** `keysetOf` of every matter left out. */
  excluded: string[];
  resolvedDates: Record<string, string>;
}

export interface ConfirmDeps<A> {
  savePlan: (groups: EditGroup[]) => Promise<Result<ImportPlan>>;
  applyPlan: (decisions: ApplyDecisions) => Promise<Result<A>>;
  /** The plan as stored now, for when nothing was edited. */
  plan: ImportPlan;
}

/** Save the edits (when any), then apply the plan with the lawyer's decisions. */
export async function confirmImport<A>(
  input: ConfirmInput,
  deps: ConfirmDeps<A>,
): Promise<Result<A>> {
  let saved = deps.plan;
  if (input.dirty) {
    const result = await deps.savePlan(input.groups);
    if (!result.ok) return result;
    saved = result.data;
  }
  return deps.applyPlan(decisionsFor(saved, new Set(input.excluded), input.resolvedDates));
}
