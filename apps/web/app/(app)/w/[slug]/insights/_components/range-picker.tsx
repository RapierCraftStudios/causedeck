'use client';
// The range picker (#85): 4 weeks, 12 weeks or a custom range as a segmented control of links, so the
// choice is in the URL (a reload or a shared link keeps it) and works without scripting. `[` and `]`
// step to the shorter and longer preset. The custom range is a plain GET form.
import type { InsightsQuery } from '@causedeck/validators/insights';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

const PRESETS = ['4w', '12w'] as const;

export interface RangePickerProps {
  basePath: string;
  query: InsightsQuery;
}

function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable]') !== null
  );
}

export function RangePicker({ basePath, query }: RangePickerProps) {
  const t = useTranslations('insights');
  const router = useRouter();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.key === '[') router.push(`${basePath}?range=4w`);
      if (event.key === ']') router.push(`${basePath}?range=12w`);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [basePath, router]);

  const item = (active: boolean) =>
    `inline-flex min-h-11 items-center px-4 text-sm md:min-h-9 focus-visible:outline-focus focus-visible:outline-2 ${
      active ? 'bg-ink text-surface font-medium' : 'text-ink'
    }`;
  return (
    <div className="flex flex-col gap-3" data-slot="insights-range">
      <nav
        aria-label={t('range.label')}
        className="border-line inline-flex self-start overflow-hidden rounded-lg border"
      >
        {PRESETS.map((preset) => (
          <Link
            key={preset}
            href={`${basePath}?range=${preset}`}
            aria-current={query.range === preset ? 'true' : undefined}
            className={item(query.range === preset)}
          >
            {t(`range.${preset}`)}
          </Link>
        ))}
        <Link
          href={`${basePath}?range=custom${query.from ? `&from=${query.from}` : ''}${query.to ? `&to=${query.to}` : ''}`}
          aria-current={query.range === 'custom' ? 'true' : undefined}
          className={item(query.range === 'custom')}
        >
          {t('range.custom')}
        </Link>
      </nav>
      {query.range === 'custom' ? (
        <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="range" value="custom" />
          <label className="text-ink flex flex-col gap-1 text-sm">
            {t('range.from')}
            <input
              type="date"
              name="from"
              required
              defaultValue={query.from}
              className="border-line bg-surface min-h-11 rounded-md border px-2 md:min-h-9"
            />
          </label>
          <label className="text-ink flex flex-col gap-1 text-sm">
            {t('range.to')}
            <input
              type="date"
              name="to"
              required
              defaultValue={query.to}
              className="border-line bg-surface min-h-11 rounded-md border px-2 md:min-h-9"
            />
          </label>
          <button
            type="submit"
            className="border-line text-ink min-h-11 rounded-md border px-4 text-sm md:min-h-9"
          >
            {t('range.apply')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
