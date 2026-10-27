'use client';

// The studio's live fact-check panel (#916), distinct from the Facts panel (facts-panel.tsx), which
// inserts record facts into slots. Rows are the claims the record disagrees with, grouped by
// verdict; a row jumps to its claim; the toolbar badge counts what is still open. It reports and
// links; it never edits text (a Fix is the verdict card's click, undone from here).
import type { LiveFactVerdict } from '@causedeck/core/drafting';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';

import { useFactLabels } from '../../lib/drafting/use-fact-check.ts';

const GROUPS = ['mismatch', 'unverified-citation', 'unsupported', 'ambiguous'] as const;

export interface FactCheckPanelProps {
  verdicts: readonly LiveFactVerdict[];
  /** Current text by block key, to show each claim as the draft words it. */
  blockTexts: Readonly<Record<string, string>>;
  hasMatter: boolean;
  checking: boolean;
  failed: boolean;
  /** A fix was applied and can still be undone. */
  canUndo: boolean;
  onJump: (verdict: LiveFactVerdict) => void;
  onUndo: () => void;
}

/** Issues still waiting for the lawyer (a match, an ignored or an asserted claim is not one). */
export const openIssues = (verdicts: readonly LiveFactVerdict[]): LiveFactVerdict[] =>
  verdicts.filter((v) => v.status !== 'match' && v.resolution === 'open');

export function FactCheckBadge({ count }: { count: number }) {
  const t = useTranslations('drafting.factCheck.panel');
  if (count === 0) return null;
  return (
    <span
      data-slot="fact-check-badge"
      aria-label={t('badge', { count })}
      className="bg-warn-subtle text-warn ms-1 rounded-full px-1.5 font-sans text-xs tabular-nums"
    >
      {count}
    </span>
  );
}

export function FactCheckPanel({
  verdicts,
  blockTexts,
  hasMatter,
  checking,
  failed,
  canUndo,
  onJump,
  onUndo,
}: FactCheckPanelProps) {
  const t = useTranslations('drafting.factCheck.panel');
  const labels = useFactLabels();
  const open = openIssues(verdicts);
  const decided = verdicts.filter((v) => v.status !== 'match' && v.resolution !== 'open');
  return (
    <section data-slot="fact-check-panel" aria-label={t('title')} className="flex flex-col gap-4">
      <h2 className="font-serif text-lg font-medium">
        {t('title')}
        <FactCheckBadge count={open.length} />
      </h2>
      {canUndo ? (
        <p role="status" className="flex items-center gap-2 font-sans text-sm">
          {t('fixed')}
          <Button type="button" size="sm" variant="ghost" onClick={onUndo}>
            {t('undo')}
          </Button>
        </p>
      ) : null}
      {!hasMatter ? (
        <p className="text-ink-muted font-sans text-sm">{t('noMatter')}</p>
      ) : failed ? (
        <p role="alert" className="text-danger font-sans text-sm">
          {t('failed')}
        </p>
      ) : checking && verdicts.length === 0 ? (
        <p role="status" className="text-ink-muted font-sans text-sm">
          {t('checking')}
        </p>
      ) : open.length === 0 ? (
        <p data-slot="fact-check-empty" className="text-ink-muted font-sans text-sm">
          {t('empty')}
        </p>
      ) : (
        GROUPS.map((group) => {
          const rows = open.filter((v) => v.status === group);
          if (rows.length === 0) return null;
          return (
            <div key={group} data-group={group} className="flex flex-col gap-1">
              <h3 className="text-ink-muted font-sans text-sm font-medium">
                {t(`group.${group}`)} ({rows.length})
              </h3>
              <ul className="flex flex-col gap-1">
                {rows.map((v) => (
                  <li key={v.claimId}>
                    <button
                      type="button"
                      aria-label={`${t('jump')}: ${labels.status[v.status]}`}
                      onClick={() => {
                        onJump(v);
                      }}
                      className="hover:bg-surface-sunken focus-visible:ring-focus w-full rounded-sm px-2 py-1 text-start font-serif text-sm focus-visible:ring-2"
                    >
                      {(blockTexts[v.blockKey] ?? '').slice(v.start, v.end)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      {decided.length > 0 ? (
        <ul className="text-ink-muted flex flex-col gap-1 font-sans text-xs">
          {decided.map((v) => (
            <li key={v.claimId}>
              {(blockTexts[v.blockKey] ?? '').slice(v.start, v.end)} ·{' '}
              {v.resolution === 'ignored' ? t('ignored') : t('asserted')}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default FactCheckPanel;
