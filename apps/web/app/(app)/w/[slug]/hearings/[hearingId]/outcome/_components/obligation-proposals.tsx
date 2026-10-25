/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { ProvenanceChip } from '@causedeck/ui/patterns';
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';

import type { Decisions, RowDecision } from './outcome-model.ts';

export interface ProposalRow {
  id: string;
  title: string;
  dueDate?: string | null;
  ownerMemberId?: string | null;
  anchorId: string | null;
  quote: string | null;
}

export function obligationRows(rows: OutcomeProposal['obligations']): ProposalRow[] {
  return rows.map((r) => ({
    id: r.proposalId,
    title: r.description,
    dueDate: r.dueDate,
    ownerMemberId: r.ownerMemberId,
    anchorId: r.anchorId,
    quote: r.quote,
  }));
}

interface ProposalListProps {
  heading: string;
  empty: string;
  rows: readonly ProposalRow[];
  decisions: Decisions;
  onDecide: (id: string, decision: RowDecision | undefined) => void;
  owners?: readonly { id: string; name: string }[] | undefined;
  /** Whether rows carry a due date and owner to edit (obligations) or only a title (tasks). */
  rich: boolean;
  disabled?: boolean | undefined;
}

/** Proposals to confirm, edit or dismiss one by one; a row left alone creates nothing. Keys: a, e, x. */
export function ProposalList({
  heading,
  empty,
  rows,
  decisions,
  onDecide,
  owners = [],
  rich,
  disabled,
}: ProposalListProps) {
  const t = useTranslations('outcome.obligations');
  const tSource = useTranslations('outcome.source');
  const [editing, setEditing] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [draft, setDraft] = useState<RowDecision>({ action: 'edit' });
  const onKey = (row: ProposalRow, event: KeyboardEvent) => {
    if (disabled || event.target !== event.currentTarget) return;
    if (event.key === 'a') onDecide(row.id, { action: 'confirm' });
    else if (event.key === 'e') {
      setDraft({
        action: 'edit',
        text: row.title,
        dueDate: row.dueDate ?? null,
        ownerMemberId: row.ownerMemberId ?? null,
      });
      setEditing(row.id);
    } else if (event.key === 'x') setDismissing(row.id);
  };
  const status = (id: string) => {
    const d = decisions[id];
    if (d === undefined) return t('undecided');
    return d.action === 'dismiss' ? `${t('dismissed')}: ${d.reason ?? ''}` : t('confirmed');
  };
  return (
    <section aria-labelledby={`${heading}-h`} className="grid gap-3">
      <h2 id={`${heading}-h`} className="text-lg font-medium">
        {heading}
      </h2>
      {rows.length === 0 ? <p className="text-muted-foreground text-sm">{empty}</p> : null}
      <ul className="grid gap-3">
        {rows.map((row) => (
          <li
            key={row.id}
            tabIndex={0}
            aria-label={row.title}
            aria-keyshortcuts="a e x"
            data-decision={decisions[row.id]?.action ?? 'undecided'}
            onKeyDown={(event) => {
              onKey(row, event);
            }}
            className="border-border grid gap-2 rounded-md border p-3"
          >
            <p className="text-sm font-medium">{decisions[row.id]?.text ?? row.title}</p>
            <div className="flex flex-wrap items-center gap-2">
              {row.anchorId === null ? null : (
                <ProvenanceChip
                  source={{
                    kind: 'capture',
                    label: row.quote === null ? tSource('voice') : row.quote.slice(0, 40),
                    ...(row.quote === null ? {} : { quote: row.quote }),
                    anchorId: row.anchorId,
                    state: 'proposed',
                  }}
                />
              )}
              <span className="text-muted-foreground text-xs" role="status">
                {status(row.id)}
              </span>
            </div>
            {editing === row.id ? (
              <div className="grid gap-2 md:grid-cols-3">
                <label className="grid gap-1 text-sm md:col-span-3">
                  {t('description')}
                  <Input
                    value={draft.text ?? ''}
                    onChange={(e) => {
                      setDraft({ ...draft, text: e.currentTarget.value });
                    }}
                  />
                </label>
                {rich ? (
                  <>
                    <label className="grid gap-1 text-sm">
                      {t('dueDate')}
                      <Input
                        type="date"
                        value={draft.dueDate ?? ''}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            dueDate: e.currentTarget.value === '' ? null : e.currentTarget.value,
                          });
                        }}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      {t('owner')}
                      <select
                        className="border-input h-9 rounded-md border bg-transparent px-2"
                        value={draft.ownerMemberId ?? ''}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            ownerMemberId:
                              e.currentTarget.value === '' ? null : e.currentTarget.value,
                          });
                        }}
                      >
                        <option value="" />
                        {owners.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                <Button
                  type="button"
                  onClick={() => {
                    onDecide(row.id, draft);
                    setEditing(null);
                  }}
                >
                  {t('save')}
                </Button>
              </div>
            ) : null}
            {dismissing === row.id ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-sm">
                  {t('dismissReason')}
                  <Input
                    value={draft.reason ?? ''}
                    onChange={(e) => {
                      setDraft({ action: 'dismiss', reason: e.currentTarget.value });
                    }}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onDecide(row.id, {
                      action: 'dismiss',
                      reason: draft.reason?.trim() ? draft.reason.trim() : t('notApplicable'),
                    });
                    setDismissing(null);
                  }}
                >
                  {draft.reason?.trim() ? t('dismiss') : t('notApplicable')}
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onDecide(row.id, { action: 'confirm' });
                }}
              >
                {t('confirm')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  setDraft({
                    action: 'edit',
                    text: row.title,
                    dueDate: row.dueDate ?? null,
                    ownerMemberId: row.ownerMemberId ?? null,
                  });
                  setEditing(row.id);
                }}
              >
                {t('edit')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  setDraft({ action: 'dismiss' });
                  setDismissing(row.id);
                }}
              >
                {t('dismiss')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
