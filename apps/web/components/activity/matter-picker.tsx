'use client';
// A matter search-and-pick list (#49), shared by the reassign dialog and the matter filter. It
// searches through `searchMattersAction` (the same workspace-scoped search as the command palette:
// `matter.read` is checked there, and the hits only include matters the member may read).
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';

import type { MatterSearchHit } from '../../app/(app)/w/[slug]/matters/actions.ts';
import type { Result } from '../../lib/safe-action.ts';

export interface MatterPickerProps {
  workspaceId: string;
  search: (input: { workspaceId: string; q: string }) => Promise<Result<MatterSearchHit[]>>;
  selectedId: string | undefined;
  onSelect: (hit: MatterSearchHit) => void;
}

export function MatterPicker({ workspaceId, search, selectedId, onSelect }: MatterPickerProps) {
  const t = useTranslations('activity.reassign');
  const id = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MatterSearchHit[] | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query === '') return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      void search({ workspaceId, q: query }).then((result) => {
        if (!cancelled) setHits(result.ok ? result.data : []);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, search, workspaceId]);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-q`}>{t('search')}</Label>
      <Input
        id={`${id}-q`}
        value={q}
        placeholder={t('placeholder')}
        autoComplete="off"
        onChange={(event) => {
          setQ(event.target.value);
        }}
      />
      {q.trim() === '' || hits === null ? null : hits.length === 0 ? (
        <p className="text-ink-muted text-sm">{t('noResults')}</p>
      ) : (
        <ul role="listbox" aria-label={t('search')} className="flex flex-col gap-1">
          {hits.map((hit) => (
            <li
              key={hit.id}
              role="option"
              aria-selected={hit.id === selectedId}
              className="contents"
            >
              <button
                type="button"
                aria-label={t('select', { title: hit.title })}
                aria-pressed={hit.id === selectedId}
                onClick={() => {
                  onSelect(hit);
                }}
                className={`border-line focus-visible:outline-ring rounded-md border px-3 py-2 text-start text-sm outline-offset-2 focus-visible:outline-2 ${hit.id === selectedId ? 'bg-accent-soft' : 'hover:bg-surface-sunken'}`}
              >
                <span className="block font-medium">{hit.title}</span>
                {hit.forum === null ? null : (
                  <span className="text-ink-muted block text-xs">{hit.forum}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
