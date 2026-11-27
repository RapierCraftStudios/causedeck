'use client';
// Judgment actions (#1176, part 3 of #1170): the reader header and each Research result card offer
// Copy citation, Save to matter, Insert into draft and Ask the copilot. The matters, notes and drafts
// are loaded on demand when a panel opens (`loadActionTargetsAction`); nothing loads with the page.
// Insert sends the passage as the candidate quote; the server re-verifies it against the stored
// judgment text (`insertAuthority`), so a quote that no longer matches is refused, not inserted.
// Ask opens the matter copilot with the judgment in context (`?judgment=<id>`).
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import {
  insertJudgmentIntoDraftAction,
  loadActionTargetsAction,
  saveJudgmentToNoteAction,
  type ActionTargets,
} from '../../app/(app)/w/[slug]/research/judgment-actions.ts';

export interface JudgmentActionsProps {
  workspaceId: string;
  slug: string;
  judgmentId: string;
  /** The citable reference (`2024 INSC 1`, or the case numbers); copied as is. */
  citation: string;
  /** The judgment's title as shown (masked when withheld); the saved authority's label. */
  label: string;
  /** The cited passage; without one there is nothing to insert into a draft. */
  quote?: string | null;
  page?: number | null;
  para?: number | null;
}

type Panel = 'save' | 'insert' | 'ask';
type Outcome =
  | { kind: 'saved'; matterId: string }
  | { kind: 'inserted'; draftId: string; version: number }
  | { kind: 'error'; message: 'failed' | 'notVerified' | 'denied' | 'loadFailed' };

const QUOTE_MAX = 2000;

const pin = (n: number | null | undefined): number | undefined =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;

/** The citation as copied and saved: the reference with its pinpoint. */
export function citationText(citation: string, page?: number | null, para?: number | null): string {
  const parts = [citation.trim()];
  if (pin(page) !== undefined) parts.push(`p. ${String(page)}`);
  if (pin(para) !== undefined) parts.push(`para ${String(para)}`);
  return parts.filter((p) => p !== '').join(', ');
}

/** The matter copilot with this judgment in context. */
export function copilotHref(slug: string, matterId: string, judgmentId: string): string {
  return `/w/${encodeURIComponent(slug)}/matters/${encodeURIComponent(matterId)}/copilot?judgment=${encodeURIComponent(judgmentId)}`;
}

const errorOf = (code: string): 'failed' | 'notVerified' | 'denied' =>
  code === 'CONFLICT' || code === 'VALIDATION'
    ? 'notVerified'
    : code === 'FORBIDDEN'
      ? 'denied'
      : 'failed';

const selectClass = 'min-h-11 rounded border px-2 font-normal';

export function JudgmentActions({
  workspaceId,
  slug,
  judgmentId,
  citation,
  label,
  quote,
  page,
  para,
}: JudgmentActionsProps) {
  const t = useTranslations('research.actions');
  const [copied, setCopied] = useState<'copied' | 'copyFailed' | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [targets, setTargets] = useState<ActionTargets | null>(null);
  const [matterId, setMatterId] = useState('');
  const [noteId, setNoteId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [after, setAfter] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, start] = useTransition();
  const text = citationText(citation, page, para);
  const passage = quote?.trim().slice(0, QUOTE_MAX) ?? '';

  function load(nextMatter?: string): void {
    start(async () => {
      const result = await loadActionTargetsAction({
        workspaceId,
        ...(nextMatter ? { matterId: nextMatter } : {}),
      });
      if (!result.ok) {
        setOutcome({ kind: 'error', message: 'loadFailed' });
        return;
      }
      setTargets(result.data);
      const draft = result.data.drafts[0];
      setDraftId(draft?.id ?? '');
      setAfter(draft?.blocks.at(-1)?.key ?? '');
      setNoteId('');
    });
  }

  function open(next: Panel): void {
    setOutcome(null);
    if (panel === next) {
      setPanel(null);
      return;
    }
    setPanel(next);
    setMatterId('');
    setTargets(null);
    load();
  }

  function pickMatter(id: string): void {
    setMatterId(id);
    setOutcome(null);
    if (id !== '' && panel !== 'ask') load(id);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch {
      setCopied('copyFailed');
    }
  }

  function save(): void {
    start(async () => {
      const result = await saveJudgmentToNoteAction({
        workspaceId,
        matterId,
        judgmentId,
        label,
        citation: text,
        ...(noteId === '' ? {} : { noteId }),
      });
      setOutcome(
        result.ok
          ? { kind: 'saved', matterId: result.data.matterId }
          : { kind: 'error', message: errorOf(result.error.code) },
      );
      if (result.ok) setPanel(null);
    });
  }

  const draft = targets?.drafts.find((d) => d.id === draftId);

  function insert(): void {
    if (draft === undefined) return;
    start(async () => {
      const result = await insertJudgmentIntoDraftAction({
        workspaceId,
        draftId: draft.id,
        versionId: draft.versionId,
        afterBlockId: after,
        judgmentId,
        quote: passage,
        ...(pin(para) === undefined ? {} : { para }),
        ...(pin(page) === undefined ? {} : { page }),
      });
      setOutcome(
        result.ok
          ? { kind: 'inserted', draftId: result.data.draftId, version: result.data.versionNo }
          : { kind: 'error', message: errorOf(result.error.code) },
      );
      if (result.ok) setPanel(null);
    });
  }

  const matters = targets?.matters ?? [];
  const toggle = (name: Panel, slot: string, disabled = false) => (
    <Button
      type="button"
      variant={panel === name ? 'primary' : 'secondary'}
      size="sm"
      className="min-h-11"
      data-slot={slot}
      aria-expanded={panel === name}
      disabled={disabled}
      onClick={() => {
        open(name);
      }}
    >
      {t(name)}
    </Button>
  );

  return (
    <div data-slot="judgment-actions" className="flex flex-col gap-2 text-sm">
      <div role="group" aria-label={t('label')} className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11"
          data-slot="judgment-copy"
          onClick={() => {
            void copy();
          }}
        >
          {t('copy')}
        </Button>
        {toggle('save', 'judgment-save')}
        {toggle('insert', 'judgment-insert', passage === '')}
        {toggle('ask', 'judgment-ask')}
        {copied === null ? null : (
          <p role="status" className="text-muted-foreground text-xs">
            {t(copied)}
          </p>
        )}
      </div>

      {panel === null ? null : (
        <div data-slot={`judgment-${panel}-panel`} className="flex flex-col gap-2 rounded border p-2">
          {targets === null && pending ? (
            <p role="status" className="text-muted-foreground text-xs">
              {t('loading')}
            </p>
          ) : targets !== null && matters.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t('noMatters')}</p>
          ) : targets !== null ? (
            <label className="flex flex-col gap-1 text-xs font-medium">
              {t('matter')}
              <select
                value={matterId}
                className={selectClass}
                onChange={(event) => {
                  pickMatter(event.target.value);
                }}
              >
                <option value="">{t('choose')}</option>
                {matters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {panel === 'ask' && matterId !== '' ? (
            <a
              data-slot="judgment-ask-link"
              className="self-start underline"
              href={copilotHref(slug, matterId, judgmentId)}
            >
              {t('openCopilot')}
            </a>
          ) : null}

          {panel === 'save' && matterId !== '' && targets !== null && !pending ? (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {t('note')}
                <select
                  value={noteId}
                  className={selectClass}
                  onChange={(event) => {
                    setNoteId(event.target.value);
                  }}
                >
                  <option value="">{t('newNote')}</option>
                  {targets.notes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title === '' ? t('untitledNote') : n.title}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" size="sm" className="min-h-11 self-start" onClick={save}>
                {t('save')}
              </Button>
            </>
          ) : null}

          {panel === 'insert' && matterId !== '' && targets !== null && !pending ? (
            targets.drafts.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t('noDrafts')}</p>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  {t('draft')}
                  <select
                    value={draftId}
                    className={selectClass}
                    onChange={(event) => {
                      const next = targets.drafts.find((d) => d.id === event.target.value);
                      setDraftId(event.target.value);
                      setAfter(next?.blocks.at(-1)?.key ?? '');
                    }}
                  >
                    {targets.drafts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  {t('after')}
                  <select
                    value={after}
                    className={selectClass}
                    onChange={(event) => {
                      setAfter(event.target.value);
                    }}
                  >
                    {(draft?.blocks ?? []).map((b) => (
                      <option key={b.key} value={b.key}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11 self-start"
                  disabled={after === ''}
                  onClick={insert}
                >
                  {t('insert')}
                </Button>
              </>
            )
          ) : null}

          {targets !== null && pending ? (
            <p role="status" className="text-muted-foreground text-xs">
              {t('working')}
            </p>
          ) : null}
        </div>
      )}

      {outcome?.kind === 'saved' ? (
        <p role="status" data-slot="judgment-saved" className="text-xs">
          {t('saved')}{' '}
          <a
            className="underline"
            href={`/w/${encodeURIComponent(slug)}/matters/${encodeURIComponent(outcome.matterId)}/research`}
          >
            {t('openNotes')}
          </a>
        </p>
      ) : outcome?.kind === 'inserted' ? (
        <p role="status" data-slot="judgment-inserted" className="text-xs">
          {t('inserted', { version: outcome.version })}{' '}
          <a
            className="underline"
            href={`/w/${encodeURIComponent(slug)}/drafts/${encodeURIComponent(outcome.draftId)}`}
          >
            {t('openDraft')}
          </a>
        </p>
      ) : outcome?.kind === 'error' ? (
        <p role="alert" data-slot="judgment-action-error" className="text-danger text-xs">
          {t(outcome.message)}
        </p>
      ) : null}
    </div>
  );
}
