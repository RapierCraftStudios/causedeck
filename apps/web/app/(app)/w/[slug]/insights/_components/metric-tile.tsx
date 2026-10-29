'use client';
// A supporting metric tile (#85): quieter than the hero, one number, its change against the baseline
// as text with an arrow (never colour alone), a one-line summary and a button that expands the chart
// and its data table in place (200 ms; a 100 ms fade under reduced motion).
import { Card, CardContent, CardHeader, CardTitle } from '@causedeck/ui/card';
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

import { deltaOf } from './format.ts';

export interface MetricTileProps {
  name: string;
  /** The dominant figure of the tile; null while hidden. */
  value: string | null;
  /** Change against the baseline; undefined hides the line (a tile without a baseline notion). */
  delta?: number | null | undefined;
  summary: string;
  /** Why the figure is withheld (fewer than 5 answers); then there is nothing to expand. */
  hiddenNote?: string | undefined;
  children?: ReactNode;
  defaultOpen?: boolean;
}

const ARROWS = { up: ArrowUp, down: ArrowDown, flat: ArrowRight, none: ArrowRight } as const;

export function MetricTile({
  name,
  value,
  delta,
  summary,
  hiddenNote,
  children,
  defaultOpen = false,
}: MetricTileProps) {
  const t = useTranslations('insights');
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  const change = delta === undefined ? null : deltaOf(delta);
  const Arrow = change === null ? ArrowRight : ARROWS[change.direction];
  const expandable = hiddenNote === undefined && children !== undefined;
  return (
    <Card data-slot="insights-tile" data-tile={name}>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {hiddenNote === undefined ? (
          <>
            <p className="text-ink text-3xl font-medium tabular-nums">{value}</p>
            {change === null ? null : (
              <p className="text-ink-muted flex items-center gap-1 text-sm">
                <Arrow aria-hidden="true" className="size-4" />
                {t(change.key, { value: change.value })}
              </p>
            )}
            <p className="text-ink-muted text-sm">{summary}</p>
          </>
        ) : (
          <p className="text-ink-muted text-sm" data-slot="insights-hidden-note">
            {hiddenNote}
          </p>
        )}
        {expandable ? (
          <>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={regionId}
              onClick={() => {
                setOpen((v) => !v);
              }}
              className="text-ink focus-visible:outline-focus inline-flex min-h-11 items-center gap-1 self-start rounded-md text-sm underline underline-offset-4 focus-visible:outline-2 md:min-h-8"
            >
              <ChevronDown
                aria-hidden="true"
                className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
              />
              {open ? t('tile.collapse') : t('tile.expand')}
            </button>
            <div
              id={regionId}
              hidden={!open}
              className="motion-safe:animate-in motion-safe:fade-in flex flex-col gap-3"
            >
              {open ? children : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
