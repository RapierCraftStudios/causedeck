// Annexure cross-check: `Annexure P-n` references in the draft against the documents attached to the
// matter (the n-th annexure document is P-n). Four rules, one id each: missing (referenced, nothing
// attached), duplicate (an index line defines the number twice), gap (a number below the highest
// reference is neither referenced nor attached) and unreferenced (attached, never referenced).
import type { FindingProvenance } from '@causedeck/validators/consistency';

import type { AnnexureMention } from './extract-entities';
import type { Hit } from './match-names';

export interface AnnexureFact {
  n: number;
  provenance: FindingProvenance;
}

const label = (n: number): string => `Annexure P-${String(n)}`;
const noFact = (): FindingProvenance => ({
  fact: 'matter.annexures',
  sourceType: 'document',
  sourceRef: null,
  anchorId: null,
});

export function checkAnnexures(
  mentions: readonly AnnexureMention[],
  attached: readonly AnnexureFact[],
  fallbackKey: string,
): Hit[] {
  const hits: Hit[] = [];
  const have = new Map(attached.map((a) => [a.n, a]));
  const referenced = new Set(mentions.filter((m) => !m.definition).map((m) => m.n));
  const seen = new Set<number>();
  for (const m of mentions) {
    const base = { blockKey: m.blockKey, start: m.start, end: m.end, found: m.raw };
    if (m.definition) {
      if (seen.has(m.n)) {
        hits.push({
          ...base,
          rule: 'annexure.duplicate',
          severity: 'error',
          expected: `${label(m.n)} once`,
          provenance: have.get(m.n)?.provenance ?? noFact(),
        });
      }
      seen.add(m.n);
    } else if (!have.has(m.n)) {
      hits.push({
        ...base,
        rule: 'annexure.missing',
        severity: 'error',
        expected: `${label(m.n)} attached to the matter`,
        provenance: noFact(),
      });
    }
  }
  const known = new Set([...referenced, ...seen]);
  const highest = Math.max(0, ...known);
  for (let n = 1; n < highest; n++) {
    if (known.has(n) || have.has(n)) continue;
    const next = mentions.find((m) => m.n > n);
    if (next === undefined) continue;
    hits.push({
      rule: 'annexure.gap',
      severity: 'warn',
      blockKey: next.blockKey,
      start: next.start,
      end: next.end,
      expected: label(n),
      found: next.raw,
      provenance: noFact(),
    });
  }
  const first = mentions[0];
  for (const a of attached) {
    if (known.has(a.n)) continue;
    hits.push({
      rule: 'annexure.unreferenced',
      severity: 'info',
      blockKey: first?.blockKey ?? fallbackKey,
      start: 0,
      end: 0,
      expected: `${label(a.n)} referenced in the draft`,
      found: '',
      provenance: a.provenance,
    });
  }
  return hits;
}
