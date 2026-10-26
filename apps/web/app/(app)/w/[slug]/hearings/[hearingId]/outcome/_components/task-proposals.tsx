/* eslint-disable unicorn/filename-case -- the route segment `[hearingId]` is fixed by the issue's path */
'use client';

import type { OutcomeProposal } from '@causedeck/validators/hearing-outcome';
import { useTranslations } from 'next-intl';

import { ProposalList, type ProposalRow } from './obligation-proposals.tsx';
import type { Decisions, RowDecision } from './outcome-model.ts';

interface TaskProposalsProps {
  tasks: OutcomeProposal['tasks'];
  decisions: Decisions;
  onDecide: (id: string, decision: RowDecision | undefined) => void;
  disabled?: boolean | undefined;
}

/** Task proposals: the same confirm, edit or dismiss decisions, titles only. */
export function TaskProposals({ tasks, decisions, onDecide, disabled }: TaskProposalsProps) {
  const t = useTranslations('outcome.tasks');
  const rows: ProposalRow[] = tasks.map((task) => ({
    id: task.proposalId,
    title: task.title,
    anchorId: task.anchorId,
    quote: task.quote,
  }));
  return (
    <ProposalList
      heading={t('title')}
      empty={t('empty')}
      rows={rows}
      decisions={decisions}
      onDecide={onDecide}
      rich={false}
      disabled={disabled}
    />
  );
}
