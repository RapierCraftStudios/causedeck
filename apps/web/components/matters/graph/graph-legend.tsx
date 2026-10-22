'use client';
// What the graph's line styles mean (#41): each sample is a 1.5 px line in the same dash pattern
// the edges use, with a text label, so the legend reads without colour.
import { useTranslations } from 'next-intl';

import { EDGE_DASH } from './graph-edges.tsx';
import type { LayoutEdgeKind } from './graph-layout.ts';

const ENTRIES = [
  ['parent_of', 'legend.parentOf'],
  ['appeal_from', 'legend.appeal'],
  ['connected', 'legend.connected'],
  ['lower_court', 'legend.lowerCourt'],
] as const satisfies readonly (readonly [LayoutEdgeKind, string])[];

export function GraphLegend() {
  const t = useTranslations('matterTimeline');
  return (
    <div data-slot="graph-legend" className="flex flex-col gap-1">
      <h3 className="text-ink-muted text-xs font-medium">{t('legend.title')}</h3>
      <ul className="flex flex-col gap-1">
        {ENTRIES.map(([kind, key]) => (
          <li key={kind} className="text-ink-muted flex items-center gap-2 text-xs">
            <svg aria-hidden="true" width="32" height="8" className="shrink-0">
              <line
                x1="1"
                y1="4"
                x2="31"
                y2="4"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray={EDGE_DASH[kind]}
                strokeLinecap={kind === 'lower_court' ? 'round' : 'butt'}
              />
              {kind === 'appeal_from' ? (
                <path d="M26 0.5 L31 4 L26 7.5 z" fill="currentColor" />
              ) : null}
            </svg>
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
