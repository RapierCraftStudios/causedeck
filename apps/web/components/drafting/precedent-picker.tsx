'use client';

// The studio's precedent picker (#904, M5): the lawyer's own approved passages, ranked for the
// selected narrative block by court, kind, language and similarity, each with the reasons it is
// suggested and where it came from (Provenance Chip). Inserting is an explicit click; the studio
// turns it into a new draft version. The ranking runs on the server (`precedent-actions.ts`).
import { Button } from '@causedeck/ui/button';
import { ProvenanceChip } from '@causedeck/ui/patterns';
import type { Block } from '@causedeck/validators/drafting';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { keyedBlocks } from '../../lib/drafting/blocks-edit.ts';
import type { Result } from '../../lib/safe-action.ts';

export interface PrecedentReason {
  code: string;
  text: string;
}

/** A passage as ranked for one block: the reasons are the ranker's own explanation. */
export interface PrecedentPassage {
  passageId: string;
  text: string;
  kind: string;
  courtId: string | null;
  language: string;
  sourceDraftVersionId: string;
  anchorId: string;
  score: number;
  reasons: PrecedentReason[];
}

export interface PrecedentSearchInput {
  workspaceId: string;
  query: string;
  courtId: string | null;
  kind: string | null;
  language: string;
}

export type PrecedentSearch = (
  input: PrecedentSearchInput,
) => Promise<Result<{ passages: PrecedentPassage[] }>>;

export type PrecedentPickerStatus = 'loading' | 'ready' | 'error' | 'offline' | 'denied';

/** The passage kind a block's id suggests (`prayer` blocks ask for prayers); anything else is open. */
export function precedentKindFor(blockKey: string): string | null {
  return /prayer/i.test(blockKey) ? 'prayer' : null;
}

export interface PrecedentPickerProps {
  passages: readonly PrecedentPassage[];
  status: PrecedentPickerStatus;
  /** Key of the selected narrative block; without one there is nothing to rank for. */
  selectedBlock?: string | undefined;
  disabled?: boolean;
  onInsert: (passage: PrecedentPassage) => void;
  onRetry?: (() => void) | undefined;
}

export function PrecedentPicker({
  passages,
  status,
  selectedBlock,
  disabled = false,
  onInsert,
  onRetry,
}: PrecedentPickerProps) {
  const t = useTranslations('drafting.precedents');
  const body = () => {
    if (selectedBlock === undefined)
      return <p className="text-ink-muted text-sm">{t('noBlock')}</p>;
    if (status === 'loading') {
      return (
        <p role="status" className="text-ink-muted text-sm">
          {t('loading')}
        </p>
      );
    }
    if (status === 'denied') return <p className="text-ink-muted text-sm">{t('denied')}</p>;
    if (status === 'offline') return <p className="text-warn text-sm">{t('offline')}</p>;
    if (status === 'error') {
      return (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p>{t('error')}</p>
          {onRetry === undefined ? null : (
            <button
              type="button"
              onClick={onRetry}
              className="border-line min-h-11 rounded-md border px-3"
            >
              {t('retry')}
            </button>
          )}
        </div>
      );
    }
    if (passages.length === 0) return <p className="text-ink-muted text-sm">{t('empty')}</p>;
    return (
      <ol className="flex flex-col gap-3">
        {passages.map((passage) => (
          <li
            key={passage.passageId}
            data-slot="precedent-passage"
            className="border-line flex flex-col gap-2 rounded-md border p-3"
          >
            <p className="font-serif text-base">{passage.text}</p>
            <ul aria-label={t('why')} className="text-ink-muted flex flex-col gap-0.5 text-xs">
              {passage.reasons.map((reason) => (
                <li key={reason.code}>{reason.text}</li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceChip
                source={{
                  kind: 'document',
                  label: t('source'),
                  quote: passage.text,
                  anchorId: passage.anchorId,
                  state: 'confirmed',
                }}
              />
              {/* The design-system button: the seal colours fail 4.5:1 at this size in both themes. */}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onInsert(passage);
                }}
                className="ms-auto min-h-11"
              >
                {t('insert')}
              </Button>
            </div>
          </li>
        ))}
      </ol>
    );
  };
  return (
    <section
      data-slot="precedent-picker"
      aria-labelledby="precedent-picker-title"
      className="flex flex-col gap-3"
    >
      <h2 id="precedent-picker-title" className="text-sm font-semibold">
        {t('title')}
      </h2>
      <p className="text-ink-muted text-xs">{t('hint')}</p>
      {body()}
    </section>
  );
}

export interface PrecedentPanelProps {
  workspaceId: string;
  blocks: readonly Block[];
  selectedBlock?: string | undefined;
  language: string;
  courtId: string | null;
  online: boolean;
  disabled?: boolean;
  search: PrecedentSearch;
  /** The lawyer chose a passage to insert into `blockKey`. */
  onInsert: (blockKey: string, passage: PrecedentPassage) => void;
}

/** Loads the ranked passages for the selected narrative block and renders the picker. */
export function PrecedentPanel(props: PrecedentPanelProps) {
  const { workspaceId, blocks, selectedBlock, language, courtId, online, search } = props;
  const target = selectedBlock;
  const block = keyedBlocks(blocks).find((entry) => entry.key === target)?.block;
  const prompt = block?.type === 'narrative' ? block.prompt : undefined;
  const [loaded, setLoaded] = useState<{
    key: string;
    status: PrecedentPickerStatus;
    passages: PrecedentPassage[];
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (target === undefined || prompt === undefined || !online) return;
    let live = true;
    void search({ workspaceId, query: prompt, courtId, kind: precedentKindFor(target), language })
      .then((result) => {
        if (!live) return;
        if (result.ok)
          setLoaded({
            key: `${target}#${String(attempt)}`,
            status: 'ready',
            passages: result.data.passages,
          });
        else {
          const denied = result.error.code === 'FORBIDDEN';
          setLoaded({
            key: `${target}#${String(attempt)}`,
            status: denied ? 'denied' : 'error',
            passages: [],
          });
        }
      })
      .catch(() => {
        if (live) setLoaded({ key: `${target}#${String(attempt)}`, status: 'error', passages: [] });
      });
    return () => {
      live = false;
    };
  }, [search, workspaceId, target, prompt, courtId, language, online, attempt]);

  const current =
    target === undefined
      ? undefined
      : loaded?.key === `${target}#${String(attempt)}`
        ? loaded
        : undefined;
  const status: PrecedentPickerStatus = !online ? 'offline' : (current?.status ?? 'loading');
  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return (
    <PrecedentPicker
      passages={current?.passages ?? []}
      status={status}
      selectedBlock={prompt === undefined ? undefined : target}
      disabled={props.disabled ?? false}
      onInsert={(passage) => {
        if (target !== undefined) props.onInsert(target, passage);
      }}
      onRetry={retry}
    />
  );
}
