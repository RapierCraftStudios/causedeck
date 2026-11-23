'use client';

// The studio's authority drawer (#1144, slice 3 of #1118): verified corpus authorities for the
// selected block, behind `copilot.enabled`. Asking is an explicit click (one metered copilot question
// per click); each candidate shows its case, pinpoint and quote with where it came from (Provenance
// Chip and the corpus link). Inserting is an explicit click too: the server re-verifies the quote
// against the stored judgment and saves it as a new paragraph in the next version
// (`authority-actions.ts`). Nothing here edits or invents a citation.
import { Button } from '@causedeck/ui/button';
import { ProvenanceChip } from '@causedeck/ui/patterns';
import type { Block } from '@causedeck/validators/drafting';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { keyedBlocks } from '../../lib/drafting/blocks-edit.ts';
import type { Result } from '../../lib/safe-action.ts';

/** What the server takes back to insert a candidate; sent unaltered. */
export interface AuthorityCandidateRef {
  judgmentId: string;
  quote: string;
  para?: number;
  page?: number;
}

export interface AuthorityCandidateView {
  candidateRef: AuthorityCandidateRef;
  title: string | null;
  neutralCitation: string | null;
  court: string | null;
  sourceUrl: string | null;
  page: number | null;
  paragraph: number | null;
}

export interface AuthorityProposal {
  candidates: AuthorityCandidateView[];
  noAuthority: boolean;
  aiBlocked: boolean;
}

export interface InsertedAuthorityView {
  versionId: string;
  versionNo: number;
  blockId: string;
}

export type AuthorityPropose = (input: {
  workspaceId: string;
  draftId: string;
  blockId: string;
  requestId?: string;
}) => Promise<Result<AuthorityProposal>>;

export type AuthorityInsert = (input: {
  workspaceId: string;
  draftId: string;
  versionId: string;
  afterBlockId: string;
  candidateRef: AuthorityCandidateRef;
}) => Promise<Result<InsertedAuthorityView>>;

export type AuthorityDrawerStatus =
  'idle' | 'loading' | 'ready' | 'aiBlocked' | 'error' | 'denied' | 'limit' | 'offline';

export type AuthorityInsertState = 'inserting' | 'inserted' | 'conflict' | 'failed';

function sourceHref(candidate: AuthorityCandidateView): string | null {
  if (candidate.sourceUrl === null) return null;
  return candidate.page === null
    ? candidate.sourceUrl
    : `${candidate.sourceUrl}#page=${String(candidate.page)}`;
}

const keyOf = (ref: AuthorityCandidateRef) =>
  `${ref.judgmentId}|${String(ref.para ?? '')}|${String(ref.page ?? '')}|${ref.quote}`;

export interface AuthorityDrawerProps {
  status: AuthorityDrawerStatus;
  candidates: readonly AuthorityCandidateView[];
  /** The selected block has text to ask about. */
  hasBlock: boolean;
  /** Offline, read-only or with unsaved edits: no new question and no insert. */
  disabled?: boolean;
  /** Unsaved edits: inserting would race the editor, so it waits for a save. */
  unsaved?: boolean;
  inserts?: Readonly<Record<string, AuthorityInsertState>>;
  onPropose: () => void;
  onInsert: (candidate: AuthorityCandidateView) => void;
}

export function AuthorityDrawer({
  status,
  candidates,
  hasBlock,
  disabled = false,
  unsaved = false,
  inserts = {},
  onPropose,
  onInsert,
}: AuthorityDrawerProps) {
  const t = useTranslations('drafting.authorityDrawer');
  const body = () => {
    if (!hasBlock) return <p className="text-ink-muted text-sm">{t('noBlock')}</p>;
    if (status === 'loading') {
      return (
        <p role="status" className="text-ink-muted text-sm">
          {t('loading')}
        </p>
      );
    }
    if (status === 'offline') return <p className="text-warn text-sm">{t('offline')}</p>;
    if (status === 'denied') return <p className="text-ink-muted text-sm">{t('denied')}</p>;
    if (status === 'aiBlocked') {
      return (
        <p data-slot="authority-ai-blocked" className="text-ink-muted text-sm">
          {t('aiBlocked')}
        </p>
      );
    }
    if (status === 'error' || status === 'limit') {
      return (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p>{t(status === 'limit' ? 'limit' : 'error')}</p>
          <button
            type="button"
            onClick={onPropose}
            disabled={disabled}
            className="border-line min-h-11 rounded-md border px-3 disabled:opacity-50"
          >
            {t('retry')}
          </button>
        </div>
      );
    }
    if (status === 'idle') return null;
    if (candidates.length === 0) {
      return (
        <p data-slot="authority-empty" className="text-ink-muted text-sm">
          {t('empty')}
        </p>
      );
    }
    return (
      <>
        {unsaved ? <p className="text-warn text-xs">{t('saveFirst')}</p> : null}
        <ol className="flex flex-col gap-3">
          {candidates.map((candidate) => {
            const key = keyOf(candidate.candidateRef);
            const state = inserts[key];
            const href = sourceHref(candidate);
            const pin =
              candidate.paragraph !== null
                ? t('para', { n: candidate.paragraph })
                : candidate.page !== null
                  ? t('page', { n: candidate.page })
                  : null;
            return (
              <li
                key={key}
                data-slot="authority-candidate"
                className="border-line flex flex-col gap-2 rounded-md border p-3"
              >
                <p className="text-sm font-semibold">{candidate.title ?? t('untitled')}</p>
                <p className="text-ink-muted text-xs">
                  {[candidate.neutralCitation, candidate.court, pin]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </p>
                <blockquote className="border-line border-s-2 ps-2 font-serif text-base">
                  {candidate.candidateRef.quote}
                </blockquote>
                <div className="flex flex-wrap items-center gap-2">
                  <ProvenanceChip
                    source={{
                      kind: 'document',
                      label: candidate.neutralCitation ?? t('source'),
                      quote: candidate.candidateRef.quote,
                      ...(candidate.page === null ? {} : { page: candidate.page }),
                      state: 'confirmed',
                    }}
                  />
                  {href === null ? null : (
                    <a
                      className="text-xs underline"
                      href={href}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      {t('openSource')}
                    </a>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled || unsaved || state === 'inserting' || state === 'inserted'}
                    onClick={() => {
                      onInsert(candidate);
                    }}
                    className="ms-auto min-h-11"
                  >
                    {state === 'inserting'
                      ? t('inserting')
                      : state === 'inserted'
                        ? t('inserted')
                        : t('insert')}
                  </Button>
                </div>
                {state === 'conflict' || state === 'failed' ? (
                  <p role="alert" className="text-danger text-xs">
                    {t(state === 'conflict' ? 'insertConflict' : 'insertFailed')}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </>
    );
  };
  return (
    <section
      data-slot="authority-drawer"
      aria-labelledby="authority-drawer-title"
      className="flex flex-col gap-3"
    >
      <h2 id="authority-drawer-title" className="text-sm font-semibold">
        {t('title')}
      </h2>
      <p className="text-ink-muted text-xs">{t('hint')}</p>
      {hasBlock && status !== 'loading' ? (
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={onPropose}
          className="min-h-11 self-start"
        >
          {status === 'idle' ? t('find') : t('findAgain')}
        </Button>
      ) : null}
      {body()}
    </section>
  );
}

export interface AuthorityDrawerPanelProps {
  workspaceId: string;
  draftId: string;
  /** The saved version being edited: where an insert lands after. */
  versionId: string;
  blocks: readonly Block[];
  selectedBlock?: string | undefined;
  online: boolean;
  disabled?: boolean;
  unsaved?: boolean;
  propose: AuthorityPropose;
  insert: AuthorityInsert;
  /** The server saved the authority as a new version. */
  onInserted: (inserted: InsertedAuthorityView) => void;
}

/** Text the server will ask about: headings, paragraphs and section titles. */
function hasText(block: Block | undefined): boolean {
  if (block === undefined) return false;
  if (block.type === 'heading' || block.type === 'paragraph') return block.text.trim() !== '';
  if (block.type === 'section') return (block.title ?? '').trim() !== '';
  return false;
}

/** Asks for the selected block's authorities on click and inserts the chosen one. */
export function AuthorityDrawerPanel(props: AuthorityDrawerPanelProps) {
  const { workspaceId, draftId, versionId, blocks, selectedBlock, online } = props;
  const block = keyedBlocks(blocks).find((entry) => entry.key === selectedBlock)?.block;
  const target = hasText(block) ? selectedBlock : undefined;
  const [loaded, setLoaded] = useState<{
    key: string;
    status: AuthorityDrawerStatus;
    candidates: AuthorityCandidateView[];
  } | null>(null);
  const [inserts, setInserts] = useState<Record<string, AuthorityInsertState>>({});

  const current = target !== undefined && loaded?.key === target ? loaded : undefined;
  const status: AuthorityDrawerStatus = !online ? 'offline' : (current?.status ?? 'idle');

  const propose = () => {
    if (target === undefined) return;
    setLoaded({ key: target, status: 'loading', candidates: [] });
    setInserts({});
    const settle = (next: Omit<NonNullable<typeof loaded>, 'key'>) => {
      setLoaded((prev) => (prev?.key === target ? { key: target, ...next } : prev));
    };
    void props
      .propose({ workspaceId, draftId, blockId: target, requestId: crypto.randomUUID() })
      .then((result) => {
        if (!result.ok) {
          const code = result.error.code;
          settle({
            status: code === 'FORBIDDEN' ? 'denied' : code === 'CONFLICT' ? 'limit' : 'error',
            candidates: [],
          });
        } else if (result.data.aiBlocked) settle({ status: 'aiBlocked', candidates: [] });
        else settle({ status: 'ready', candidates: result.data.candidates });
      })
      .catch(() => {
        settle({ status: 'error', candidates: [] });
      });
  };

  const insert = (candidate: AuthorityCandidateView) => {
    if (target === undefined) return;
    const key = keyOf(candidate.candidateRef);
    setInserts((prev) => ({ ...prev, [key]: 'inserting' }));
    void props
      .insert({
        workspaceId,
        draftId,
        versionId,
        afterBlockId: target,
        candidateRef: candidate.candidateRef,
      })
      .then((result) => {
        if (result.ok) {
          setInserts((prev) => ({ ...prev, [key]: 'inserted' }));
          props.onInserted(result.data);
        } else {
          const state = result.error.code === 'CONFLICT' ? 'conflict' : 'failed';
          setInserts((prev) => ({ ...prev, [key]: state }));
        }
      })
      .catch(() => {
        setInserts((prev) => ({ ...prev, [key]: 'failed' }));
      });
  };

  return (
    <AuthorityDrawer
      status={status}
      candidates={current?.candidates ?? []}
      hasBlock={target !== undefined}
      disabled={(props.disabled ?? false) || !online}
      unsaved={props.unsaved ?? false}
      inserts={inserts}
      onPropose={propose}
      onInsert={insert}
    />
  );
}
