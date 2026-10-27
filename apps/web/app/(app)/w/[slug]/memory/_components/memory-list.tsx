'use client';
// The memory screen (#73): layer tabs (the tab lives in the URL), the cards of the chosen layer, the
// proposal tray, "Pause all memory", the court-note form and the review reminder. Offline the cards
// stay readable and every change is disabled with the explanation. A court note is labelled "Your
// own notes", and its form says not to record analysis of individual judges.
import { Button } from '@causedeck/ui/button';
import { PatternEmptyState, ProposalTray, ScopeChip } from '@causedeck/ui/patterns';
import { Tabs, TabsList, TabsTrigger } from '@causedeck/ui/tabs';
import { Textarea } from '@causedeck/ui/textarea';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import {
  MEMORY_TABS,
  cardsOfLayer,
  type CardView,
  type MemoryTab,
} from '../../../../../../lib/memory/memory-state.ts';
import { addNoteAction, confirmAction, dismissAction, pauseAllAction } from '../actions.ts';

import { MemoryCards, useMemoryRun } from './memory-cards.tsx';
import { EditSheet } from './memory-dialogs.tsx';

export interface ProposalView {
  id: string;
  title: string;
  value: string;
  scope: CardView['scope'];
  /** How many times it was seen; null when the evidence has no count. */
  seen: number | null;
}

export interface MemoryScreenProps {
  workspaceId: string;
  slug: string;
  tab: MemoryTab;
  cards: CardView[];
  proposals: ProposalView[];
  canWrite: boolean;
  isOwner: boolean;
  pausedAll: boolean;
  reviewDue: boolean;
  forceOffline: boolean;
}

export function MemoryScreen(props: MemoryScreenProps) {
  const { workspaceId, slug, tab, cards, proposals, canWrite, isOwner, pausedAll } = props;
  const t = useTranslations('memory');
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnline() && !props.forceOffline;
  const { run, busy } = useMemoryRun();
  const [editingProposal, setEditingProposal] = useState<ProposalView | null>(null);
  const layerCards = cardsOfLayer(cards, tab);
  const nothing = cards.length === 0 && proposals.length === 0;

  const select = (next: string) => {
    router.replace(next === MEMORY_TABS[0] ? pathname : `${pathname}?layer=${next}`);
  };

  return (
    <div data-route="memory" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
          <p className="text-ink-muted text-sm">{t('intro')}</p>
        </div>
        {canWrite ? (
          <Button
            variant="ghost"
            disabled={!online || busy}
            aria-pressed={pausedAll}
            onClick={() => {
              void run(
                () => pauseAllAction({ workspaceId, paused: !pausedAll }),
                pausedAll ? t('pauseAll.resume') : t('pauseAll.pause'),
              );
            }}
          >
            {pausedAll ? t('pauseAll.resume') : t('pauseAll.pause')}
          </Button>
        ) : null}
      </header>
      {online ? null : (
        <p
          role="status"
          data-pattern-state="offline"
          className="border-line bg-surface-sunken rounded-lg border p-3 text-sm"
        >
          {t('offline')}
        </p>
      )}
      {pausedAll ? (
        <p role="status" className="border-line bg-surface-sunken rounded-lg border p-3 text-sm">
          {t('pauseAll.paused')}
        </p>
      ) : null}
      {canWrite ? null : <p className="text-ink-subtle text-xs">{t('readOnly')}</p>}
      {props.reviewDue && canWrite && cards.length > 0 ? (
        <section
          data-slot="review-reminder"
          aria-labelledby="review-reminder-title"
          className="border-line bg-surface-raised flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
        >
          <div>
            <h2 id="review-reminder-title" className="text-sm font-semibold">
              {t('review.reminderTitle')}
            </h2>
            <p className="text-ink-muted text-sm">{t('review.reminderBody')}</p>
          </div>
          <Button asChild>
            <Link href={`/w/${slug}/memory/review`}>{t('review.start')}</Link>
          </Button>
        </section>
      ) : null}

      <ProposalTray
        proposals={proposals.map((p) => ({
          id: p.id,
          title: p.title,
          statement: t('tray.statement', { title: p.title, value: p.value }),
          evidence:
            p.seen === null ? t('tray.evidenceNone') : t('tray.evidence', { count: p.seen }),
          scopeChip: (
            <ScopeChip
              scope={p.scope}
              labels={{
                user: t('scope.user'),
                workspace: t('scope.workspace'),
                matter: t('scope.matter'),
              }}
            />
          ),
        }))}
        offline={!online}
        viewOnly={!canWrite}
        disabled={busy}
        labels={{
          heading: (count) => t('tray.heading', { count }),
          save: t('actions.confirm'),
          edit: t('actions.edit'),
          dismiss: t('tray.dismiss'),
          shortcuts: t('tray.shortcuts'),
          offline: t('tray.offline'),
          viewOnly: t('readOnly'),
        }}
        onSave={(id) => {
          void run(() => confirmAction({ workspaceId, proposalId: id }), t('tray.saved'));
        }}
        onEdit={(id) => {
          setEditingProposal(proposals.find((p) => p.id === id) ?? null);
        }}
        onDismiss={(id) => {
          void run(() => dismissAction({ workspaceId, proposalId: id }), t('tray.dismissed'));
        }}
      />
      <EditSheet
        card={
          editingProposal === null
            ? null
            : {
                id: editingProposal.id,
                layer: 'M1',
                key: editingProposal.title,
                title: editingProposal.title,
                value: editingProposal.value,
                scope: editingProposal.scope,
                matterId: null,
                sourceType: 'ai',
                confirmationState: 'confirmed',
                paused: false,
                sharedWithChamber: false,
                lastUsedAt: null,
                updatedAt: '',
              }
        }
        isOwner={false}
        pending={busy}
        onClose={() => {
          setEditingProposal(null);
        }}
        onSave={({ value }) => {
          if (editingProposal === null) return;
          void run(
            () => confirmAction({ workspaceId, proposalId: editingProposal.id, value }),
            t('tray.saved'),
          ).then((ok) => {
            if (ok) setEditingProposal(null);
          });
        }}
      />

      {nothing ? (
        <PatternEmptyState data-pattern-state="empty" message={t('empty')} />
      ) : (
        <Tabs value={tab} onValueChange={select}>
          <TabsList aria-label={t('tabListLabel')}>
            {MEMORY_TABS.map((layer) => (
              <TabsTrigger key={layer} value={layer}>
                {t(`layers.${layer}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {nothing ? null : (
        <section aria-label={t(`layers.${tab}`)} className="flex flex-col gap-4">
          {tab === 'M4' ? <p className="text-ink-muted text-sm">{t('notes.label')}</p> : null}
          {layerCards.length === 0 ? (
            <p className="text-ink-muted text-sm">{t('emptyLayer')}</p>
          ) : (
            <MemoryCards
              workspaceId={workspaceId}
              slug={slug}
              cards={layerCards}
              canWrite={canWrite}
              isOwner={isOwner}
              offline={!online}
            />
          )}
          {tab === 'M4' && canWrite ? (
            <AddNote workspaceId={workspaceId} offline={!online} />
          ) : null}
        </section>
      )}
    </div>
  );
}

function AddNote({ workspaceId, offline }: { workspaceId: string; offline: boolean }) {
  const t = useTranslations('memory.add');
  const { run, busy } = useMemoryRun();
  const [value, setValue] = useState('');
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (value.trim() === '') return;
    void run(
      () => addNoteAction({ workspaceId, key: 'M4.hall_note', value: value.trim() }),
      t('submit'),
    ).then((ok) => {
      if (ok) setValue('');
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label={t('title')}>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('value')}
        <Textarea
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          aria-describedby="memory-judge-note"
        />
      </label>
      <p id="memory-judge-note" className="text-ink-muted text-xs">
        {t('judgeNote')}
      </p>
      <div>
        <Button type="submit" disabled={offline || busy || value.trim() === ''}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
