// View models for the M5 pages (#903): the precedent and playbook cards as the client holds them
// (plain data, dates as ISO strings), the split of pending proposals into precedent, playbook and
// generic ones, and the screen state. Pure: no core or db import.
export const M5_PRECEDENT_KEY = 'M5.precedent';
export const M5_PLAYBOOK_KEY = 'M5.playbook';

/** The Proposal Tray binds these keys to the focused proposal: S saves, E edits, X dismisses. */
export const M5_PROPOSAL_SHORTCUTS = { save: 's', edit: 'e', dismiss: 'x' } as const;

export interface M5ProposalInput {
  id: string;
  key: string;
}

/** The M5 proposals go through the M5 actions; the generic tray keeps the rest. */
export function splitProposals<P extends M5ProposalInput>(
  proposals: readonly P[],
): { precedents: P[]; playbooks: P[]; generic: P[] } {
  return {
    precedents: proposals.filter((p) => p.key === M5_PRECEDENT_KEY),
    playbooks: proposals.filter((p) => p.key === M5_PLAYBOOK_KEY),
    generic: proposals.filter((p) => p.key !== M5_PRECEDENT_KEY && p.key !== M5_PLAYBOOK_KEY),
  };
}

export interface PrecedentCardView {
  itemId: string;
  text: string;
  kind: string;
  courtId: string | null;
  language: string;
  sourceDraftVersionId: string;
  anchorId: string;
  status: 'active' | 'retired';
  scope: 'mine' | 'chamber';
  lastUsedAt: string | null;
}

export interface PrecedentInput {
  itemId: string;
  text: string;
  kind: string;
  courtId: string | null;
  language: string;
  sourceDraftVersionId: string;
  anchorId: string;
  status: 'active' | 'retired';
  sharedWithChamber: boolean;
}

/** `lastUsed` maps a memory item id to its last use (from `listMemoryWithUsage`). */
export function toPrecedentCard(
  view: PrecedentInput,
  lastUsed: ReadonlyMap<string, Date | null>,
): PrecedentCardView {
  return {
    itemId: view.itemId,
    text: view.text,
    kind: view.kind,
    courtId: view.courtId,
    language: view.language,
    sourceDraftVersionId: view.sourceDraftVersionId,
    anchorId: view.anchorId,
    status: view.status,
    scope: view.sharedWithChamber ? 'chamber' : 'mine',
    lastUsedAt: lastUsed.get(view.itemId)?.toISOString() ?? null,
  };
}

export interface PlaybookCardView {
  itemId: string;
  name: string;
  courtId: string | null;
  format: string;
  standardPrayers: string[];
  annexureOrder: string[];
  scope: 'mine' | 'chamber';
  lastUsedAt: string | null;
}

export interface PlaybookInput {
  itemId: string;
  name: string;
  courtId: string | null;
  format: string;
  standardPrayers: string[];
  annexureOrder: string[];
  sharedWithChamber: boolean;
}

export function toPlaybookCard(
  view: PlaybookInput,
  lastUsed: ReadonlyMap<string, Date | null>,
): PlaybookCardView {
  return {
    itemId: view.itemId,
    name: view.name,
    courtId: view.courtId,
    format: view.format,
    standardPrayers: view.standardPrayers,
    annexureOrder: view.annexureOrder,
    scope: view.sharedWithChamber ? 'chamber' : 'mine',
    lastUsedAt: lastUsed.get(view.itemId)?.toISOString() ?? null,
  };
}

/** One entry per non-empty line, trimmed: the playbook editor's prayer and annexure lists. */
export function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Last-use date by item id from the rows of `listMemoryWithUsage`. */
export function lastUsedById(
  rows: readonly { id: string; lastUsedAt?: Date | null }[],
): Map<string, Date | null> {
  return new Map(rows.map((row) => [row.id, row.lastUsedAt ?? null]));
}

export type M5ScreenState = 'ready' | 'empty' | 'offline';

export function m5ScreenState(input: { count: number; proposals: number; offline: boolean }) {
  if (input.offline) return 'offline' as const;
  return input.count === 0 && input.proposals === 0 ? ('empty' as const) : ('ready' as const);
}
