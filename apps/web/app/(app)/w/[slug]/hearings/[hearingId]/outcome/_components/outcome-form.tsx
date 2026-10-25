/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import { Textarea } from '@causedeck/ui/textarea';
import { StageBadge, type Resolution } from '@causedeck/ui/patterns';
import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { confirmOutcomeAction, recordManualOutcomeAction } from '../actions.ts';

import { ConfirmBar } from './confirm-bar.tsx';
import { ConflictCard } from './conflict-card.tsx';
import { NextDateField } from './next-date-field.tsx';
import { ProposalList, obligationRows } from './obligation-proposals.tsx';
import { blocker, toConfirmation, type Decisions, type RowDecision } from './outcome-model.ts';
import { TaskProposals } from './task-proposals.tsx';
import { TranscriptDrawer } from './transcript-drawer.tsx';

interface OutcomeFormProps {
  workspaceId: string;
  proposal: OutcomeProposal;
  owners: readonly { id: string; name: string }[];
  excerpts: readonly string[];
  /** The role may confirm outcomes; a viewer sees the proposal and no actions. */
  canWrite: boolean;
}

const queueKey = (hearingId: string) => `outcome-queue:${hearingId}`;

/**
 * The confirmation screen (#62). Nothing is pre-decided: the next date, a conflict and each
 * direction need a human action before Confirm enables. Offline, Confirm queues the decision on
 * this device; on reconnect it goes through the same action, which re-checks the canonical date and
 * never overwrites a confirmed one.
 */
export function OutcomeForm({
  workspaceId,
  proposal,
  owners,
  excerpts,
  canWrite,
}: OutcomeFormProps) {
  const t = useTranslations('outcome');
  const [summary, setSummary] = useState(proposal.summary?.value ?? '');
  const [reason, setReason] = useState(proposal.adjournmentReason?.value ?? '');
  const [stage, setStage] = useState(proposal.stageAfter?.value ?? '');
  const [resolution, setResolution] = useState<Resolution>({ kind: 'unresolved' });
  const [conflictChoice, setConflictChoice] = useState<'current' | 'proposed' | undefined>();
  const [obligations, setObligations] = useState<Decisions>({});
  const [tasks, setTasks] = useState<Decisions>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState<string | undefined>();
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(false);
  const [done, setDone] = useState(proposal.confirmed);

  const draft = {
    summary,
    adjournmentReason: reason,
    stageAfter: stage,
    resolution,
    conflictChoice,
    obligations,
    tasks,
  };
  const blocked = blocker(proposal, draft);
  const manual = proposal.obligations.length === 0 && proposal.tasks.length === 0;
  const readOnly = !canWrite || done;

  const send = useCallback(
    async (payload: ReturnType<typeof toConfirmation>) => {
      const manualOnly =
        payload.obligations?.length === 0 &&
        payload.tasks?.length === 0 &&
        proposal.state === 'empty';
      const run = manualOnly ? recordManualOutcomeAction : confirmOutcomeAction;
      const body = manualOnly ? { ...payload, obligations: undefined, tasks: undefined } : payload;
      const result = await run({ workspaceId, ...body });
      return result;
    },
    [workspaceId, proposal.state],
  );

  const submit = useCallback(async () => {
    if (blocked !== null || readOnly || pending) return;
    const payload = toConfirmation(proposal, draft);
    if (!navigator.onLine) {
      localStorage.setItem(queueKey(proposal.hearingId), JSON.stringify(payload));
      setQueued(true);
      setStatus(t('offline.queued'));
      return;
    }
    setPending(true);
    setFailure(undefined);
    const result = await send(payload).catch(() => null);
    setPending(false);
    if (result?.ok === true) {
      setDone(true);
      setStatus(t('done'));
    } else {
      const message = result?.error.code === 'FORBIDDEN' ? t('forbidden') : t('failed');
      setFailure(message);
      setStatus(message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    blocked,
    readOnly,
    pending,
    proposal,
    summary,
    reason,
    stage,
    resolution,
    conflictChoice,
    obligations,
    tasks,
    send,
    t,
  ]);

  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      const stored = localStorage.getItem(queueKey(proposal.hearingId));
      if (stored === null) return;
      localStorage.removeItem(queueKey(proposal.hearingId));
      setQueued(false);
      void send(JSON.parse(stored) as ReturnType<typeof toConfirmation>).then((result) => {
        if (result.ok) {
          setDone(true);
          setStatus(t('done'));
        } else {
          setFailure(t('failed'));
        }
      });
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [proposal.hearingId, send, t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [submit]);

  const decide =
    (set: (fn: (d: Decisions) => Decisions) => void) =>
    (id: string, decision: RowDecision | undefined) => {
      set((d) => ({ ...d, [id]: decision }));
    };

  const needsYou = proposal.state === 'needs_you';
  const hint =
    proposal.state === 'processing'
      ? t('processingHint')
      : proposal.state === 'empty'
        ? t('emptyHint')
        : needsYou
          ? t('needsYouHint')
          : null;

  return (
    <form
      data-state={proposal.state}
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {!online ? (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          {t('offline.banner')}
        </p>
      ) : null}
      {hint === null ? null : (
        <p role="status" className="text-sm">
          <strong>
            {proposal.state === 'processing'
              ? t('processing')
              : needsYou
                ? t('needsYou')
                : null}{' '}
          </strong>
          {hint}
        </p>
      )}
      {done ? <p className="text-sm">{t('confirmedHint')}</p> : null}
      <div className="grid gap-2">
        <label htmlFor="outcome-summary" className="text-sm font-medium">
          {t('summary.label')}
        </label>
        <Textarea
          id="outcome-summary"
          value={summary}
          readOnly={readOnly}
          placeholder={t('summary.placeholder')}
          onChange={(event) => {
            setSummary(event.currentTarget.value);
          }}
        />
        <TranscriptDrawer excerpts={excerpts} language={proposal.language} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          {t('adjournmentReason')}
          <input
            className="border-input h-9 rounded-md border bg-transparent px-2"
            value={reason}
            readOnly={readOnly}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('stageAfter')}
          <input
            className="border-input h-9 rounded-md border bg-transparent px-2"
            value={stage}
            readOnly={readOnly}
            onChange={(event) => {
              setStage(event.currentTarget.value);
            }}
          />
        </label>
        {stage.trim() === '' ? null : <StageBadge stage="numbered" label={stage} />}
      </div>
      <NextDateField
        nextDate={proposal.nextDate}
        resolution={resolution}
        onResolve={setResolution}
        disabled={readOnly}
      />
      {proposal.conflict === null ? null : (
        <ConflictCard
          conflict={proposal.conflict}
          proposedSource={
            proposal.nextDate === undefined ? '' : t(`source.${proposal.nextDate.source}`)
          }
          chosen={conflictChoice}
          onChoose={setConflictChoice}
          disabled={readOnly}
        />
      )}
      {manual ? null : (
        <>
          <ProposalList
            heading={t('obligations.title')}
            empty={t('obligations.empty')}
            rows={obligationRows(proposal.obligations)}
            decisions={obligations}
            onDecide={decide(setObligations)}
            owners={owners}
            rich
            disabled={readOnly}
          />
          <TaskProposals
            tasks={proposal.tasks}
            decisions={tasks}
            onDecide={decide(setTasks)}
            disabled={readOnly}
          />
        </>
      )}
      {readOnly ? null : (
        <ConfirmBar
          blocked={blocked}
          pending={pending}
          status={status}
          note={queued ? t('offline.queued') : failure}
          onConfirm={() => void submit()}
        />
      )}
    </form>
  );
}
