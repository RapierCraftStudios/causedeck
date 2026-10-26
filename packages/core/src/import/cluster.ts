// Clustering of proceedings into matters (#57, #548). Deterministic: nodes are processed in key
// order, there is no clock or randomness, and group ids come from the sorted member keys. Links:
// a main petition with its W.M.P./I.A./misc children (`parentProceedingKey`), connected batches
// heard together, an appeal chain by CNR or lower-court number (O.S. -> A.S. -> S.A., W.P. -> W.A.)
// and the same party aliases. Each group carries the confidence of its weakest link and a reason;
// an ungrouped proceeding is a group of one.

export interface ClusterNode {
  key: string;
  parentKey: string | null;
  connectedKeys: readonly string[];
  cnr: string | null;
  /** The lower-court case or CNR this proceeding appeals from, as printed. */
  lowerCourtRef: string | null;
  /** The case number label, matched against another's `lowerCourtRef`. */
  label: string | null;
  /** Normalised party spellings; two nodes sharing one are weakly linked. */
  partyKeys: readonly string[];
}

export interface ClusterGroup {
  /** Member keys, sorted. */
  keys: string[];
  confidence: number;
  reason: string;
}

type LinkKind = 'parent_child' | 'connected_batch' | 'appeal_cnr' | 'appeal_case' | 'same_party';

const LINKS: Readonly<Record<LinkKind, { confidence: number; reason: string }>> = {
  parent_child: { confidence: 0.95, reason: 'main petition with its child proceedings' },
  connected_batch: { confidence: 0.9, reason: 'connected matters heard together' },
  appeal_cnr: { confidence: 0.9, reason: 'appeal linked by CNR' },
  appeal_case: { confidence: 0.8, reason: 'appeal linked by lower-court case number' },
  same_party: { confidence: 0.6, reason: 'same parties' },
};
const LINK_ORDER = Object.keys(LINKS) as LinkKind[];

/** Code-unit order: the same on every host, unlike localeCompare. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compact = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9/]/g, '');

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    let root = key;
    for (let next = this.parent.get(root); next !== undefined && next !== root;) {
      root = next;
      next = this.parent.get(root);
    }
    return root;
  }

  union(a: string, b: string): void {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra === rb) return;
    // The smaller key is the root, so the result does not depend on call order.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

export function clusterProceedings(input: readonly ClusterNode[]): ClusterGroup[] {
  const nodes = [...input].sort((a, b) => compareText(a.key, b.key));
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const byCnr = new Map<string, string>();
  const byLabel = new Map<string, string>();
  const byParty = new Map<string, string>();
  for (const node of nodes) {
    if (node.cnr !== null && !byCnr.has(compact(node.cnr))) byCnr.set(compact(node.cnr), node.key);
    for (const ref of [node.label, node.key]) {
      if (ref !== null && !byLabel.has(compact(ref))) byLabel.set(compact(ref), node.key);
    }
  }

  const sets = new UnionFind();
  const edges: { a: string; kind: LinkKind }[] = [];
  const link = (a: string, b: string, kind: LinkKind): void => {
    if (a === b) return;
    sets.union(a, b);
    edges.push({ a, kind });
  };

  for (const node of nodes) {
    sets.add(node.key);
    if (node.parentKey !== null && byKey.has(node.parentKey)) {
      link(node.key, node.parentKey, 'parent_child');
    }
    for (const other of node.connectedKeys) {
      if (byKey.has(other)) link(node.key, other, 'connected_batch');
    }
    if (node.lowerCourtRef !== null) {
      const ref = compact(node.lowerCourtRef);
      const viaCnr = byCnr.get(ref);
      const viaCase = byLabel.get(ref);
      if (viaCnr !== undefined) link(node.key, viaCnr, 'appeal_cnr');
      else if (viaCase !== undefined) link(node.key, viaCase, 'appeal_case');
    }
    for (const party of node.partyKeys) {
      const first = byParty.get(party);
      if (first === undefined) byParty.set(party, node.key);
      else link(node.key, first, 'same_party');
    }
  }

  const groups = new Map<string, { keys: string[]; kinds: Set<LinkKind>; confidence: number }>();
  for (const node of nodes) {
    const root = sets.find(node.key);
    const group = groups.get(root) ?? { keys: [], kinds: new Set(), confidence: 1 };
    group.keys.push(node.key);
    groups.set(root, group);
  }
  for (const edge of edges) {
    const group = groups.get(sets.find(edge.a));
    if (group === undefined) continue;
    group.kinds.add(edge.kind);
    group.confidence = Math.min(group.confidence, LINKS[edge.kind].confidence);
  }

  return [...groups.values()]
    .map((group) => ({
      keys: group.keys,
      confidence: group.confidence,
      reason:
        group.kinds.size === 0
          ? 'single proceeding'
          : LINK_ORDER.filter((kind) => group.kinds.has(kind))
              .map((kind) => LINKS[kind].reason)
              .filter((reason, index, all) => all.indexOf(reason) === index)
              .join('; '),
    }))
    .sort((a, b) => compareText(a.keys[0] ?? '', b.keys[0] ?? ''));
}
