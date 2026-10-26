// The consistency checker: a pure function of the draft's blocks and the matter facts handed in. No
// I/O, no clock, no model call (a static test keeps the ai package out of this folder). Findings are
// ordered by position, then rule, so the same input always gives the same report. Nothing is logged.
import type { Block } from '@causedeck/validators/drafting';
import type { Finding, FindingCounts } from '@causedeck/validators/consistency';

import { checkAnnexures, type AnnexureFact } from './annexures';
import { collectText, extractEntities } from './extract-entities';
import { checkCaseNumbers, type ProceedingFact } from './match-case-numbers';
import { checkDates, type DateFact } from './match-dates';
import { checkNames, type Hit, type PartyFact } from './match-names';

export interface ConsistencyFacts {
  parties: readonly PartyFact[];
  proceedings: readonly ProceedingFact[];
  listingDates: readonly DateFact[];
  orderDates: readonly DateFact[];
  /** Attached annexure documents; null when the actor may not list them, which skips the annexure rules. */
  annexures: readonly AnnexureFact[] | null;
}

export interface CheckResult {
  findings: Finding[];
  counts: FindingCounts;
}

export const EMPTY_FACTS: ConsistencyFacts = {
  parties: [],
  proceedings: [],
  listingDates: [],
  orderDates: [],
  annexures: [],
};

const toFinding = (h: Hit): Finding => ({
  id: `${h.rule}:${h.blockKey}:${String(h.start)}`,
  severity: h.severity,
  rule: h.rule,
  span: { blockKey: h.blockKey, start: h.start, end: h.end },
  expected: h.expected,
  found: h.found,
  provenance: h.provenance,
  ...(h.fix ? { fix: h.fix } : {}),
});

export function checkDraft(input: {
  blocks: readonly Block[];
  facts: ConsistencyFacts;
}): CheckResult {
  const { blocks, facts } = input;
  const entities = extractEntities(blocks);
  const text = collectText(blocks);
  const order = new Map(text.map((t, i) => [t.key, i]));
  const hits = [
    ...checkNames(entities.names, facts.parties),
    ...checkCaseNumbers(entities.caseNumbers, facts.proceedings),
    ...checkDates(entities.dates, facts.listingDates, facts.orderDates),
    ...(facts.annexures === null
      ? []
      : checkAnnexures(entities.annexures, facts.annexures, text[0]?.key ?? 'b')),
  ];
  const at = (h: Hit): number => order.get(h.blockKey) ?? Number.MAX_SAFE_INTEGER;
  hits.sort(
    (a, b) =>
      at(a) - at(b) || a.start - b.start || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
  );
  const findings = hits.map(toFinding);
  const counts: FindingCounts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return { findings, counts };
}
