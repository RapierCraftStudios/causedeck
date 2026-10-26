'use client';

// The studio's Versions panel (#827): the saved versions, newest first. Choosing one previews what
// restoring it would change (a line diff against the open draft) and restores only on confirm, as a
// new version: the old ones stay.
import type { Block } from '@causedeck/validators/drafting';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { diffBlocks, hasChanges } from '../../lib/drafting/blocks-edit.ts';

export interface DraftVersionView {
  versionNo: number;
  createdAt: string;
  /** The version's blocks, when loaded; the preview needs them. */
  blocks?: Block[];
}

export interface VersionDrawerProps {
  versions: readonly DraftVersionView[];
  currentVersionNo: number;
  /** The blocks as edited now, what a restore replaces. */
  currentBlocks: readonly Block[];
  disabled?: boolean;
  onRestore: (versionNo: number) => void;
}

export function VersionDrawer({
  versions,
  currentVersionNo,
  currentBlocks,
  disabled = false,
  onRestore,
}: VersionDrawerProps) {
  const t = useTranslations('drafting.panels.versions');
  const [chosen, setChosen] = useState<number | undefined>();
  const picked = versions.find((v) => v.versionNo === chosen);
  const lines =
    picked?.blocks === undefined ? undefined : diffBlocks(currentBlocks, picked.blocks);

  return (
    <section data-slot="version-drawer" aria-labelledby="versions-title" className="flex flex-col gap-3">
      <h2 id="versions-title" className="text-sm font-semibold">
        {t('title')}
      </h2>
      <ul className="flex flex-col gap-1">
        {versions.map((v) => (
          <li key={v.versionNo}>
            <button
              type="button"
              aria-pressed={chosen === v.versionNo}
              disabled={v.versionNo === currentVersionNo}
              onClick={() => {
                setChosen(chosen === v.versionNo ? undefined : v.versionNo);
              }}
              className="focus-visible:ring-focus aria-pressed:bg-seal-subtle min-h-11 w-full rounded-md px-2 text-start text-sm focus-visible:ring-2"
            >
              {v.versionNo === currentVersionNo ? t('current') : t('number', { number: v.versionNo })}
              <span className="text-ink-muted ms-2 text-xs">{v.createdAt.slice(0, 10)}</span>
            </button>
          </li>
        ))}
      </ul>
      {picked === undefined ? null : (
        <div className="border-line flex flex-col gap-2 rounded-md border p-2">
          <h3 className="text-sm font-medium">{t('diffTitle', { number: picked.versionNo })}</h3>
          {lines !== undefined && !hasChanges(lines) ? (
            <p className="text-ink-muted text-sm">{t('noChanges')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5 font-serif text-sm">
              {(lines ?? []).filter((l) => l.kind !== 'same').map((line, i) => (
                <li
                  key={i}
                  className={line.kind === 'added' ? 'text-success' : 'text-danger line-through'}
                >
                  <span className="sr-only">{line.kind === 'added' ? t('added') : t('removed')}: </span>
                  {line.kind === 'added' ? '+ ' : '− '}
                  {line.text}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onRestore(picked.versionNo);
              setChosen(undefined);
            }}
            className="bg-seal text-seal-fg focus-visible:ring-focus min-h-11 rounded-md px-3 text-sm focus-visible:ring-2 disabled:opacity-50"
          >
            {t('confirm')}
          </button>
        </div>
      )}
    </section>
  );
}
