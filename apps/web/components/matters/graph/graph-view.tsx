'use client';
// The matter graph (#41, spike §7 Matter Graph View): the proceedings of one matter as a
// `role="tree"` laid out by `layoutGraph` (children indented, appeal chains left to right) with
// SVG connectors behind. Nodes are HTML, so text, focus and selection behave like any list.
// Keyboard (WAI-ARIA tree, roving tabindex): Up/Down move through the visible items, Home/End jump
// to the ends, Right expands a group or enters its first member, Left collapses it or returns to
// it, `*` expands every group, Enter or Space selects (Shift adds to the selection) and toggles a
// group. Selecting filters the timeline (the owner holds the selection and mirrors it in the URL).
// A parent's miscellaneous children beyond three sit behind one chip (`W.M.P. × 12`).
import { Button } from '@causedeck/ui/button';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import type { GraphNodeView } from '../../../lib/matters/timeline.ts';
import { cn } from '../matter-card.tsx';

import { GraphEdges } from './graph-edges.tsx';
import { layoutGraph, type LayoutEdgeInput, type LayoutGroupInput } from './graph-layout.ts';
import { GraphLegend } from './graph-legend.tsx';
import { GraphNode } from './graph-node.tsx';

export interface GraphViewProps {
  nodes: readonly GraphNodeView[];
  edges: readonly LayoutEdgeInput[];
  groups: readonly (LayoutGroupInput & { caseType: string })[];
  /** Selected proceedings (empty: all). */
  selected: readonly string[];
  onSelect: (id: string, additive: boolean) => void;
  onClear: () => void;
  /** Groups shown open on first render (stories, tests). */
  defaultExpanded?: readonly string[];
  className?: string;
}

export function GraphView({
  nodes,
  edges,
  groups,
  selected,
  onSelect,
  onClear,
  defaultExpanded = [],
  className,
}: GraphViewProps) {
  const t = useTranslations('matterTimeline');
  const baseId = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(defaultExpanded));
  const layout = useMemo(
    () => layoutGraph({ nodes, edges, groups, expanded }),
    [nodes, edges, groups, expanded],
  );
  const [active, setActive] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const picked = useMemo(() => new Set(selected), [selected]);
  const current = active !== null && layout.items.some((i) => i.id === active) ? active : null;
  const tabStop = current ?? layout.items[0]?.id ?? null;

  const siblings = useMemo(() => {
    // posinset / setsize among items sharing a depth under the same parent, in layout order.
    const out = new Map<string, { pos: number; size: number }>();
    const parentKey = (index: number) => {
      const item = layout.items[index];
      if (item === undefined) return '';
      for (let j = index - 1; j >= 0; j -= 1) {
        const earlier = layout.items[j];
        if (earlier !== undefined && earlier.depth < item.depth) return earlier.id;
      }
      return '';
    };
    const counts = new Map<string, number>();
    layout.items.forEach((item, index) => {
      const key = `${parentKey(index)}|${String(item.depth)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      out.set(item.id, { pos: counts.get(key) ?? 1, size: 0 });
    });
    layout.items.forEach((item, index) => {
      const key = `${parentKey(index)}|${String(item.depth)}`;
      const entry = out.get(item.id);
      if (entry) entry.size = counts.get(key) ?? 1;
    });
    return out;
  }, [layout.items]);

  function focusItem(id: string) {
    setActive(id);
    refs.current.get(id)?.focus();
  }

  function toggleGroup(id: string, open: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function activate(id: string, additive: boolean) {
    const group = groupById.get(id);
    if (group === undefined) onSelect(id, additive);
    else toggleGroup(id, !expanded.has(id));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string) {
    const items = layout.items;
    const index = items.findIndex((i) => i.id === id);
    const item = items[index];
    if (item === undefined) return;
    const go = (to: number) => {
      const target = items[Math.min(items.length - 1, Math.max(0, to))];
      if (target !== undefined) focusItem(target.id);
    };
    switch (event.key) {
      case 'ArrowDown':
        go(index + 1);
        break;
      case 'ArrowUp':
        go(index - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(items.length - 1);
        break;
      case 'ArrowRight':
        if (item.type === 'group' && !expanded.has(id)) toggleGroup(id, true);
        else if (item.type === 'group') go(index + 1);
        break;
      case 'ArrowLeft':
        if (item.type === 'group' && expanded.has(id)) toggleGroup(id, false);
        else if (item.groupId !== null) focusItem(item.groupId);
        break;
      case '*':
        setExpanded(new Set(groups.map((g) => g.id)));
        break;
      case 'Enter':
      case ' ':
        activate(id, event.shiftKey);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function onClick(event: MouseEvent<HTMLDivElement>, id: string) {
    setActive(id);
    activate(id, event.shiftKey);
  }

  return (
    <div data-slot="graph-view" className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-base font-medium">{t('graph.title')}</h2>
        {selected.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={onClear} className="pointer-coarse:min-h-11">
            {t('graph.showAll')}
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto pb-2">
        <div
          role="tree"
          aria-label={t('graph.treeLabel')}
          aria-multiselectable="true"
          className="relative"
          style={{ width: layout.width, height: layout.height }}
        >
          <GraphEdges layout={layout} highlighted={picked} appealLabel={t('graph.appeal')} />
          {layout.items.map((item) => {
            const node = byId.get(item.id);
            const group = groupById.get(item.id);
            const place = siblings.get(item.id);
            const isOpen = expanded.has(item.id);
            const descriptionId = `${baseId}-${item.id}-desc`;
            return (
              <div
                key={item.id}
                ref={(el) => {
                  if (el === null) refs.current.delete(item.id);
                  else refs.current.set(item.id, el);
                }}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-posinset={place?.pos}
                aria-setsize={place?.size}
                aria-selected={group === undefined ? picked.has(item.id) : undefined}
                aria-expanded={group === undefined ? undefined : isOpen}
                aria-describedby={node === undefined ? undefined : descriptionId}
                aria-label={
                  group === undefined
                    ? undefined
                    : `${t('graph.group', {
                        caseType: group.caseType,
                        count: group.memberIds.length,
                      })}, ${t('graph.groupLabel', {
                        caseType: group.caseType,
                        count: group.memberIds.length,
                      })}`
                }
                tabIndex={item.id === tabStop ? 0 : -1}
                data-item-id={item.id}
                onClick={(event) => {
                  onClick(event, item.id);
                }}
                onFocus={() => {
                  setActive(item.id);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, item.id);
                }}
                className="focus-visible:outline-ring absolute cursor-pointer rounded-lg outline-offset-2 focus-visible:outline-2"
                style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
              >
                {node !== undefined ? (
                  <GraphNode
                    node={node}
                    selected={picked.has(item.id)}
                    descriptionId={descriptionId}
                  />
                ) : group !== undefined ? (
                  <div
                    data-slot="graph-group"
                    className="border-line-strong bg-surface-sunken flex h-full items-center gap-1.5 rounded-full border px-3 text-sm font-medium tabular-nums"
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        'size-4 transition-transform duration-200 ease-out motion-reduce:transition-none',
                        isOpen && 'rotate-90',
                      )}
                    />
                    <span dir="auto">
                      {t('graph.group', {
                        caseType: group.caseType,
                        count: group.memberIds.length,
                      })}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <GraphLegend />
    </div>
  );
}
