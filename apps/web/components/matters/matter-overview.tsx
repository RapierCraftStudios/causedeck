'use client';
// The Overview tab (#390, #40 design spec). One column on phones; from 768 px two columns (next
// date and proceedings left, people and documents right); from 1280 px the 12-column grid with an
// 8-column main column (Next-date hero, conflicts, proceedings, synopsis) and a 4-column aside
// (people, recent documents, open obligations). Every card has its empty state; mutation cards get
// `offline` from the browser, so Confirm, the conflict choices and the synopsis editor switch off
// while offline. Write controls come only with `canWrite` (absent, not disabled, for readers).
import { Badge } from '@causedeck/ui/badge';
import { buttonVariants } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { FileText, Inbox, Megaphone, Scale, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { MatterOverviewView } from '../../lib/matters/workspace.ts';

import { NoticeList, type NoticeView } from '../notices/notice-list.tsx';

import { DateConflictCard, type ChooseNextDateSourceAction } from './date-conflict-card.tsx';
import { useOnline } from './matters-offline-banner.tsx';
import { NextDateCard, type ConfirmNextDateAction } from './next-date-card.tsx';
import { SynopsisEditor, type UpdateMatterAction } from './synopsis-editor.tsx';

export interface MatterOverviewActions {
  confirmNextDate: ConfirmNextDateAction;
  chooseNextDateSource: ChooseNextDateSourceAction;
  updateMatter: UpdateMatterAction;
}

export interface MatterOverviewProps {
  matter: MatterOverviewView;
  workspaceId: string;
  slug: string;
  /** `matter.write`: Confirm, the conflict choices and the synopsis editor. */
  canWrite: boolean;
  actions: MatterOverviewActions;
  /** Dev preview of the offline state. */
  forcedOffline?: boolean;
  /** Official notices that affect this matter (#588); empty when none or when they could not load. */
  notices?: readonly NoticeView[];
}

function Card({ title, slot, children }: { title: string; slot: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      data-slot={slot}
      className="border-line bg-surface flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 className="text-ink-muted text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function ProceedingsCard({ matter }: { matter: MatterOverviewView }) {
  const t = useTranslations('matters.workspace');
  const { proceedings } = matter;
  if (proceedings.count === 0) {
    return (
      <Card title={t('proceedings.title')} slot="matter-proceedings">
        <EmptyState
          data-pattern-state="empty"
          data-proceedings="empty"
          icon={<Scale />}
          title={t('proceedings.empty')}
          className="py-6"
        />
      </Card>
    );
  }
  const { lead } = proceedings;
  return (
    <Card title={t('proceedings.title')} slot="matter-proceedings">
      <p className="text-sm tabular-nums">{t('proceedings.count', { count: proceedings.count })}</p>
      {lead === null ? null : (
        <p data-proceedings-lead="" className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="neutral">{t('proceedings.lead')}</Badge>
          <span className="font-mono font-medium tabular-nums">
            {lead.number !== null && lead.year !== null
              ? t('proceedings.caseNumber', {
                  type: lead.caseType,
                  number: lead.number,
                  year: lead.year,
                })
              : t('proceedings.unnumbered', { type: lead.caseType })}
          </span>
          <span className="text-ink-muted">{lead.forum}</span>
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5" aria-label={t('proceedings.title')}>
        {proceedings.byState.map(({ state, count }) => (
          <li key={state}>
            <Badge tone="outline" data-proceedings-state={state} className="tabular-nums">
              {t(`proceedings.states.${state}`)} · {count}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PeopleCard({ matter }: { matter: MatterOverviewView }) {
  const t = useTranslations('matters.workspace');
  return (
    <Card title={t('people.title')} slot="matter-people">
      {matter.people.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          data-people="empty"
          icon={<Users />}
          title={t('people.empty')}
          className="py-6"
        />
      ) : (
        <dl className="flex flex-col gap-2 text-sm">
          {matter.people.map((group) => (
            <div key={group.kind} data-people-group={group.kind} className="flex flex-col gap-0.5">
              <dt className="text-ink-muted text-xs">{t(`people.kinds.${group.kind}`)}</dt>
              {group.people.map((person) => (
                <dd key={person.id}>{person.name}</dd>
              ))}
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function DocumentsCard({ matter, slug }: { matter: MatterOverviewView; slug: string }) {
  const t = useTranslations('matters.workspace');
  return (
    <Card title={t('documents.title')} slot="matter-documents">
      {matter.recentDocuments.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          data-documents="empty"
          icon={<Inbox />}
          title={t('documents.empty')}
          className="py-6"
          action={
            <Link
              href={`/w/${encodeURIComponent(slug)}/inbox`}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {t('documents.openInbox')}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {matter.recentDocuments.map((doc) => (
            <li
              key={doc.id}
              data-document={doc.id}
              className="flex flex-wrap items-center gap-1.5 text-sm"
            >
              <FileText aria-hidden="true" className="text-ink-muted size-4" />
              <Badge tone="neutral">{t(`documents.kinds.${doc.kind}`)}</Badge>
              {doc.language === null ? null : (
                <Badge tone="outline" lang={doc.language}>
                  {doc.language.toUpperCase()}
                </Badge>
              )}
              <span className="text-ink-muted text-xs">
                {t(`documents.textStatus.${doc.textStatus}`)}
              </span>
              <span className="text-ink-muted text-xs tabular-nums">
                {t('documents.added', { date: doc.added })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** "Affecting this matter" (#588, D-048): the official notices matched to this matter's forums. */
function NoticesCard({ notices }: { notices: readonly NoticeView[] }) {
  const t = useTranslations('notices');
  return (
    <Card title={t('matterCard.title')} slot="matter-notices">
      {notices.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          data-notices="empty"
          icon={<Megaphone />}
          title={t('matterCard.empty')}
          className="py-6"
        />
      ) : (
        <NoticeList notices={notices} compact />
      )}
    </Card>
  );
}

function ObligationsCard({ matter }: { matter: MatterOverviewView }) {
  const t = useTranslations('matters.workspace');
  return (
    <Card title={t('obligations.title')} slot="matter-obligations">
      <p data-open-obligations={matter.openObligations} className="text-sm tabular-nums">
        {t('obligations.count', { count: matter.openObligations })}
      </p>
    </Card>
  );
}

export function MatterOverview({
  matter,
  workspaceId,
  slug,
  canWrite,
  actions,
  forcedOffline = false,
  notices = [],
}: MatterOverviewProps) {
  const online = useOnline();
  const offline = forcedOffline || !online;
  return (
    <div
      data-slot="matter-overview"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12 xl:gap-6"
    >
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
        <NextDateCard
          workspaceId={workspaceId}
          nextDate={matter.nextDate}
          canWrite={canWrite}
          offline={offline}
          action={actions.confirmNextDate}
        />
        {matter.conflicts.map((conflict) => (
          <DateConflictCard
            key={`${conflict.current.listingId}:${conflict.proposed.listingId}`}
            workspaceId={workspaceId}
            conflict={conflict}
            canWrite={canWrite}
            offline={offline}
            action={actions.chooseNextDateSource}
          />
        ))}
        <ProceedingsCard matter={matter} />
        <NoticesCard notices={notices} />
        <SynopsisEditor
          workspaceId={workspaceId}
          matterId={matter.id}
          synopsis={matter.synopsis}
          denied={matter.synopsisDenied}
          canWrite={canWrite}
          offline={offline}
          action={actions.updateMatter}
        />
      </div>
      <aside className="flex min-w-0 flex-col gap-4 xl:col-span-4">
        <PeopleCard matter={matter} />
        <DocumentsCard matter={matter} slug={slug} />
        <ObligationsCard matter={matter} />
      </aside>
    </div>
  );
}
