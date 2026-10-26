'use client';
// A proceeding in the matter graph (#41): the case number as printed, the forum abbreviation, the
// Stage Badge and the state as a word (colour is never the only cue). A proceeding that has no
// number yet (SR/FR stage) says `Unnumbered` and shows its SR or FR number instead. Presentational:
// `graph-view.tsx` owns the `treeitem` wrapper, selection and the keyboard. The node's relations
// ("appeal from W.P. 678/2026") are part of its accessible description, not only drawn lines.
import { StageBadge } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';

import type { GraphNodeView } from '../../../lib/matters/timeline.ts';
import { cn } from '../matter-card.tsx';

export const STATE_KEYS = {
  filed: 'states.filed',
  sr_fr: 'states.sr_fr',
  defects: 'states.defects',
  re_presented: 'states.re_presented',
  numbered: 'states.numbered',
  disposed: 'states.disposed',
} as const;

/** The node's relations as sentences (`appeal from W.P. 678/2026`), for screen readers. */
export function useRelationTexts(node: GraphNodeView): string[] {
  const t = useTranslations('matterTimeline');
  return node.relations.map((relation) => {
    const label = relation.label;
    if (relation.kind === 'appeal_from') {
      return relation.direction === 'from'
        ? t('graph.relations.appealFrom', { label })
        : t('graph.relations.appealedIn', { label });
    }
    if (relation.kind === 'lower_court') {
      return relation.direction === 'from'
        ? t('graph.relations.lowerCourt', { label })
        : t('graph.relations.lowerCourtOf', { label });
    }
    return t('graph.relations.connected', { label });
  });
}

export interface GraphNodeProps {
  node: GraphNodeView;
  selected: boolean;
  /** Id of the element holding the description, for `aria-describedby` on the wrapper. */
  descriptionId: string;
}

export function GraphNode({ node, selected, descriptionId }: GraphNodeProps) {
  const t = useTranslations('matterTimeline');
  const relations = useRelationTexts(node);
  const sr = node.srFrNo === null ? null : t('graph.srFrNo', { number: node.srFrNo });
  return (
    <div
      data-slot="graph-node"
      data-selected={selected ? '' : undefined}
      className={cn(
        'border-line bg-surface-elevated flex h-full min-w-0 flex-col justify-center gap-1 rounded-lg border px-3 py-1.5',
        selected && 'border-accent bg-accent-soft',
      )}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-serif text-sm font-medium tabular-nums" dir="auto">
          {node.unnumbered ? node.caseType : node.label}
        </span>
        <span className="text-ink-muted shrink-0 text-xs">{node.forum}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <StageBadge stage={node.state} label={t(STATE_KEYS[node.state])} />
        {node.unnumbered ? (
          <span className="border-line text-ink-muted rounded-full border px-1.5 text-xs">
            {t('graph.unnumbered')}
          </span>
        ) : null}
        {sr === null ? null : <span className="text-ink-muted text-xs tabular-nums">{sr}</span>}
      </div>
      <span id={descriptionId} className="sr-only">
        {[t(STATE_KEYS[node.state]), ...relations].join('. ')}
      </span>
    </div>
  );
}
