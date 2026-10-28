// Pure slot resolvers over a supplied Facts object. Nothing is fetched here; the caller supplies
// the facts and every resolved value says which fact it came from.
import { SLOT_RESOLVERS, type Block, type SlotResolver } from '@causedeck/validators/drafting';

import { collectSlots } from './blocks';

export interface Facts {
  matter?: { title?: string; cnr?: string; court?: string };
  parties?: { petitioner?: string; respondent?: string };
  hearing?: { nextDate?: string; bench?: string };
  advocate?: { name?: string; enrolmentNo?: string };
  workspace?: { name?: string };
  /** An existing client of the matter's workspace; never a free-text recipient. */
  client?: { name?: string };
  /** Junior or senior counsel receiving a covering letter; a non-client recipient. */
  counsel?: { name?: string };
  /** ISO date used for `date.today`; supplied so resolution stays pure. */
  today?: string;
}

export type Provenance = { kind: 'fact'; source: string } | { kind: 'missing'; source: string };

export interface Resolution {
  value: string;
  provenance: Provenance;
}

const SOURCES: Record<SlotResolver, (facts: Facts) => string | undefined> = {
  'matter.title': (f) => f.matter?.title,
  'matter.cnr': (f) => f.matter?.cnr,
  'matter.court': (f) => f.matter?.court,
  'party.petitioner': (f) => f.parties?.petitioner,
  'party.respondent': (f) => f.parties?.respondent,
  'hearing.next_date': (f) => f.hearing?.nextDate,
  'hearing.bench': (f) => f.hearing?.bench,
  'advocate.name': (f) => f.advocate?.name,
  'advocate.enrolment_no': (f) => f.advocate?.enrolmentNo,
  'workspace.name': (f) => f.workspace?.name,
  'client.name': (f) => f.client?.name,
  'counsel.name': (f) => f.counsel?.name,
  'date.today': (f) => f.today,
};

export const missingMarker = (resolver: string): string => `[[missing: ${resolver}]]`;

export function resolveSlot(resolver: SlotResolver, facts: Facts): Resolution {
  const value = SOURCES[resolver](facts)?.trim();
  if (value === undefined || value === '') {
    return { value: missingMarker(resolver), provenance: { kind: 'missing', source: resolver } };
  }
  return { value, provenance: { kind: 'fact', source: resolver } };
}

/** Resolution of every slot block in the tree, keyed by block key. */
export function resolveBlocks(blocks: readonly Block[], facts: Facts): Map<string, Resolution> {
  const out = new Map<string, Resolution>();
  for (const { key, block } of collectSlots(blocks)) {
    out.set(key, resolveSlot(block.resolver, facts));
  }
  return out;
}

/** Resolved facts as plain strings, for prompts; unresolved ones are left out. */
export function factsForPrompt(facts: Facts): Record<string, string> {
  const out: Record<string, string> = {};
  for (const resolver of SLOT_RESOLVERS) {
    const r = resolveSlot(resolver, facts);
    if (r.provenance.kind === 'fact') out[resolver] = r.value;
  }
  return out;
}

/**
 * Slots that stop an export: those that did not resolve, unless the user acknowledged them.
 * `acknowledged` is `true` for all, or the list of resolvers the user accepted as missing.
 */
export function exportBlockers(
  blocks: readonly Block[],
  facts: Facts,
  acknowledged: boolean | readonly SlotResolver[] = false,
): { key: string; resolver: SlotResolver }[] {
  if (acknowledged === true) return [];
  const accepted = acknowledged === false ? [] : acknowledged;
  return collectSlots(blocks)
    .filter(({ block }) => resolveSlot(block.resolver, facts).provenance.kind === 'missing')
    .filter(({ block }) => !accepted.includes(block.resolver))
    .map(({ key, block }) => ({ key, resolver: block.resolver }));
}
