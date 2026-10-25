'use client';
// The drafts screen (#736): ready-to-send cards, the states around them (skeleton, empty, error,
// offline, denied) and the split view that opens a draft beside the list from 768 px up.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { ErrorState, PermissionDenied } from '@causedeck/ui/patterns';
import type { Audience, Language, ShareChannel } from '@causedeck/validators/outward-draft';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { DraftEditor, type DraftView } from './draft-editor.tsx';
import { LANGUAGE_LABELS } from './language-switcher.tsx';

export interface DraftCardView {
  id: string;
  matterTitle: string;
  audience: Audience;
  language: Language;
  templateOnly: boolean;
  createdAt: string;
  preview: string;
}

export type OutwardState = 'loading' | 'empty' | 'error' | 'offline' | 'denied';

export function DraftList({
  drafts,
  activeId,
  onOpen,
}: {
  drafts: DraftCardView[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('outward');
  const format = useFormatter();
  return (
    <ul aria-label={t('list.label')} className="grid content-start gap-3">
      {drafts.map((draft) => (
        <li key={draft.id}>
          <button
            type="button"
            aria-label={t('list.open', { matter: draft.matterTitle })}
            aria-current={draft.id === activeId}
            onClick={() => {
              onOpen(draft.id);
            }}
            className="bg-surface-raised border-line focus-visible:ring-focus grid w-full gap-2 rounded-xl border p-4 text-start focus-visible:ring-2 pointer-coarse:min-h-11"
          >
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="bg-surface-sunken rounded-full px-2 py-0.5">
                {t(`audience.${draft.audience}`)}
              </span>
              <span className="bg-surface-sunken rounded-full px-2 py-0.5" lang={draft.language}>
                {LANGUAGE_LABELS[draft.language]}
              </span>
              {draft.templateOnly ? (
                <span className="text-ink-muted">{t('list.templateOnly')}</span>
              ) : null}
            </span>
            <span className="text-ink font-serif text-lg">{draft.matterTitle}</span>
            <span lang={draft.language} className="text-ink-muted line-clamp-3 text-sm">
              {draft.preview}
            </span>
            <span className="text-ink-muted text-xs">
              {t('list.age', { age: format.relativeTime(new Date(draft.createdAt)) })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The non-list states of the screen. */
export function OutwardStates({ state, onRetry }: { state: OutwardState; onRetry?: () => void }) {
  const t = useTranslations('outward');
  if (state === 'loading') {
    return (
      <SkeletonGroup data-pattern-state="loading" labels={{ loading: t('loading') }}>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </SkeletonGroup>
    );
  }
  if (state === 'denied') return <PermissionDenied message={t('denied')} />;
  if (state === 'error') {
    return (
      <ErrorState
        data-pattern-state="error"
        title={t('error.title')}
        onRetry={onRetry}
        labels={{ retry: t('error.retry') }}
      />
    );
  }
  if (state === 'offline') {
    return (
      <p role="status" data-pattern-state="offline" className="text-ink-muted text-sm">
        {t('offline')}
      </p>
    );
  }
  return (
    <div data-pattern-state="empty" className="grid gap-1 py-8 text-center">
      <p className="text-ink font-serif text-lg">{t('empty.title')}</p>
      <p className="text-ink-muted text-sm">{t('empty.description')}</p>
    </div>
  );
}

export interface DraftsWorkspaceProps {
  drafts: DraftCardView[];
  /** The open draft, loaded by the page (`?draft=`). */
  open: DraftView | null;
  offline: boolean;
  readOnly: boolean;
  onOpen: (id: string | null) => void;
  onSave: (draftId: string, body: string) => Promise<{ ok: boolean; warnings: string[] }>;
  onShared: (draftId: string, channel: ShareChannel) => Promise<boolean>;
  onLanguageChange: (draftId: string, language: Language) => void;
}

/** List and editor side by side from 768 px; one at a time below. */
export function DraftsWorkspace({
  drafts,
  open,
  offline,
  readOnly,
  onOpen,
  onSave,
  onShared,
  onLanguageChange,
}: DraftsWorkspaceProps) {
  const t = useTranslations('outward');
  const [announce] = useState('');
  return (
    <div className="grid gap-6 md:grid-cols-[20rem_1fr]">
      <div className={open === null ? '' : 'hidden md:block'}>
        {drafts.length === 0 ? (
          <OutwardStates state={offline ? 'offline' : 'empty'} />
        ) : (
          <DraftList drafts={drafts} activeId={open?.id ?? null} onOpen={onOpen} />
        )}
      </div>
      {open === null ? null : (
        <div>
          <button
            type="button"
            className="text-ink-muted mb-2 text-sm md:hidden"
            onClick={() => {
              onOpen(null);
            }}
          >
            {t('editor.back')}
          </button>
          <DraftEditor
            draft={open}
            offline={offline}
            readOnly={readOnly}
            onSave={(body) => onSave(open.id, body)}
            onShared={(channel) => onShared(open.id, channel)}
            onLanguageChange={(language) => {
              onLanguageChange(open.id, language);
            }}
            onClose={() => {
              onOpen(null);
            }}
          />
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
