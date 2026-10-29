// The real brief memory port (#74): M2 always-carry rules and brief format, the M3 synopsis and the
// M4 court notes, read through `memoryFor` (so scope, clerk view, paused and deleted items and
// pause-all are decided by the memory engine, never here) and cited through `recordUsage`, once per
// item per brief render. Without memory every method returns what `emptyMemoryProvider` returns, so
// a brief falls back to the default format. No method reads anything about a judge or a bench: the
// memory keys read here are the lawyer's own (M2, M3, M4).
import { schema, withWorkspace } from '@causedeck/db';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_BRIEF_FORMAT,
  readAlwaysCarry,
  readBriefFormat,
  type Brief,
  type BriefFormat,
  type MemoryItem,
} from '@causedeck/validators';

import {
  memoryFor,
  proposeFromEdit,
  recordUsage,
  type MemoryActor,
  type MemoryDeps,
} from '../memory/index.ts';

import type {
  CarryQuery,
  CarryRule,
  MemoryLine,
  MemoryNote,
  MemoryProvider,
  MemoryQuery,
  MemorySynopsis,
} from './scope.ts';

export interface BriefMemoryProvider extends MemoryProvider {
  format(query: MemoryQuery): Promise<BriefFormat | null>;
  observeCarryRemoval(query: MemoryQuery, rule: CarryRule): Promise<void>;
}

const actorOf = (q: { workspaceId: string; userId?: string | undefined }): MemoryActor | null =>
  q.userId === undefined ? null : { workspaceId: q.workspaceId, userId: q.userId };

/** A saved item as a brief line: the lawyer's own words, confirmed by them (manual provenance). */
function lineOf(item: MemoryItem, text: string): MemoryLine {
  return {
    text,
    label: null,
    source_type: 'manual',
    source_ref: item.id,
    anchor_id: null,
    confidence: item.confidence,
    confirmation_state: 'confirmed',
  };
}

const textOf = (item: MemoryItem): string | null =>
  typeof item.value === 'string' ? item.value : null;

/** The chamber's default brief verbosity (`workspace_settings.brief_format`), `full` when unset. */
async function workspaceBriefDefault(deps: MemoryDeps, workspaceId: string): Promise<string> {
  const [row] = await withWorkspace(deps.db, { workspaceId }, (tx) =>
    tx
      .select({ briefFormat: schema.workspaceSettings.briefFormat })
      .from(schema.workspaceSettings)
      .where(eq(schema.workspaceSettings.workspaceId, workspaceId)),
  );
  return row?.briefFormat ?? 'full';
}

export function createBriefMemoryProvider(deps: MemoryDeps): BriefMemoryProvider {
  const read = (actor: MemoryActor, layer: 'M2' | 'M3' | 'M4', matterId?: string) =>
    memoryFor(deps, actor, {
      layers: [layer],
      purpose: 'brief',
      ...(matterId === undefined ? {} : { matterId }),
    });

  /** Cite the use; a failure to log never breaks the brief. */
  async function cite(
    actor: MemoryActor,
    item: MemoryItem,
    q: { listingId?: string; matterId?: string },
  ) {
    try {
      await recordUsage(deps, actor, {
        itemId: item.id,
        usedIn: 'brief',
        outputRef: q.listingId ?? null,
        matterId: item.matterId ?? q.matterId ?? null,
      });
    } catch {
      // The citation is best effort.
    }
  }

  return {
    async alwaysCarry(q: CarryQuery): Promise<CarryRule[]> {
      const actor = actorOf(q);
      if (actor === null) return [];
      const { items } = await read(actor, 'M2', q.matterId);
      const rules: CarryRule[] = [];
      for (const item of items) {
        if (item.key !== 'M2.always_carry') continue;
        const fit = readAlwaysCarry(item.value).filter(
          (r) => r.when === 'always' || q.firstHearing === true,
        );
        if (fit.length === 0) continue;
        fit.forEach((r, i) =>
          rules.push({
            id: fit.length === 1 ? item.id : `${item.id}.${String(i)}`,
            label: r.label,
          }),
        );
        await cite(actor, item, q);
      }
      return rules;
    },

    async synopsis(q: MemoryQuery): Promise<MemorySynopsis | null> {
      const actor = actorOf(q);
      if (actor === null) return null;
      const { items } = await read(actor, 'M3', q.matterId);
      const main = items.find((i) => i.key === 'M3.synopsis' && textOf(i) !== null);
      if (main === undefined) return null;
      const note =
        q.canStrategy === true ? items.find((i) => i.key === 'M3.strategy_note') : undefined;
      await cite(actor, main, q);
      if (note !== undefined) await cite(actor, note, q);
      const strategyText = note === undefined ? null : textOf(note);
      return {
        line: lineOf(main, textOf(main) ?? ''),
        strategy: note === undefined || strategyText === null ? null : lineOf(note, strategyText),
      };
    },

    lastHearing(): Promise<MemoryLine | null> {
      return Promise.resolve(null);
    },

    async courtNotes(q: MemoryQuery): Promise<MemoryNote[]> {
      const actor = actorOf(q);
      if (actor === null) return [];
      const { items } = await read(actor, 'M4');
      const notes: MemoryNote[] = [];
      for (const item of items) {
        const text = textOf(item);
        if (text === null) continue;
        await cite(actor, item, q);
        // `memoryFor` returns only the actor's own and chamber-shared notes.
        notes.push({
          authorUserId: q.userId,
          shared: item.sharedWithChamber,
          line: lineOf(item, text),
        });
      }
      return notes;
    },

    async format(q: MemoryQuery): Promise<BriefFormat | null> {
      const actor = actorOf(q);
      if (actor === null) return null;
      const { items } = await read(actor, 'M2');
      for (const item of items) {
        if (item.key !== 'M2.brief_format') continue;
        const format = readBriefFormat(item.value);
        if (format === null) continue;
        await cite(actor, item, q);
        return format;
      }
      // No format of the member's own: the chamber default chosen in onboarding (#92). `full` is
      // the unchanged brief, so only a `short` default changes anything.
      return (await workspaceBriefDefault(deps, q.workspaceId)) === 'short'
        ? { ...DEFAULT_BRIEF_FORMAT, verbosity: 'short' }
        : null;
    },

    async observeCarryRemoval(q: MemoryQuery, rule: CarryRule): Promise<void> {
      if (q.listingId === undefined) return;
      try {
        await proposeFromEdit(
          deps,
          { workspaceId: q.workspaceId, userId: q.userId },
          {
            outputId: q.listingId,
            pattern: `Stop carrying ${rule.label}`.slice(0, 200),
            key: 'M2.always_carry',
            scope: 'user',
          },
        );
      } catch {
        // Learning from a removal is best effort.
      }
    },
  };
}

const SHORT_LAST_ORDER_LINES = 1;
const SHORT_CONTEXT_PASSAGES = 1;

/**
 * The brief in the member's format: sections in the listed order (their keys come first, in the
 * brief's own order after those), and 'short' keeps one last-order line and one context passage.
 * No format gives the brief unchanged.
 */
export function applyBriefFormat(brief: Brief, format: BriefFormat | null): Brief {
  if (format === null) return brief;
  const shortened: Brief =
    format.verbosity === 'short'
      ? {
          ...brief,
          last_order: brief.last_order.slice(0, SHORT_LAST_ORDER_LINES),
          context: brief.context.slice(0, SHORT_CONTEXT_PASSAGES),
        }
      : brief;
  const ordered: Record<string, unknown> = {};
  for (const key of format.order) ordered[key] = shortened[key];
  return Object.assign(ordered, shortened);
}
