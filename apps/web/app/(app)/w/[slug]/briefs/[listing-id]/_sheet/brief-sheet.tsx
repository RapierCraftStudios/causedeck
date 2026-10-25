'use client';
// The Brief Sheet (#61, PRD PR-1): one A4-proportioned sheet, the same document on screen and in
// print. Sticky action bar and section-jump chips on a narrow screen; rails on a wide one.
// There is no send, email or share-outside action: 'Share inside workspace' copies this page's own
// link, which only members can open.
import { Button } from '@causedeck/ui/button';
import { SheetPage, ReadinessMeter, type ReadinessMeterSegment } from '@causedeck/ui/patterns';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { Masthead } from './masthead.tsx';
import { isEmptyBrief, printTitle, visibleSections, type SheetViewModel } from './model.ts';
import { PreparedControl } from './prepared-control.tsx';
import { SectionIndex } from './section-index.tsx';
import { Sections } from './sections.tsx';
import { useBriefKeyboard } from './use-brief-keyboard.tsx';
import './print.css';

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return online;
}

export function BriefSheet({ view }: { view: SheetViewModel }) {
  const t = useTranslations('brief');
  const online = useOnline();
  const [printNotes, setPrintNotes] = useState(view.printNotes);
  const [copied, setCopied] = useState(false);
  const { brief, readiness } = view;
  const keys = useMemo(() => visibleSections(brief), [brief]);

  const print = () => {
    const previous = document.title;
    const today = new Date().toISOString().slice(0, 10);
    document.title = printTitle((v) => t('printTitle', v), view.masthead, today);
    window.print();
    document.title = previous;
  };
  const { dialog } = useBriefKeyboard(keys, print);

  const segments: ReadinessMeterSegment[] = (
    Object.keys(readiness.segments) as (keyof typeof readiness.segments)[]
  ).map((key) => ({
    key,
    label: t(`readiness.${key}`),
    met: readiness.segments[key],
  }));
  const assembled = new Date(view.assembledAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div data-brief-sheet data-print-notes={printNotes ? 'on' : 'off'} className="grid gap-3">
      {online ? null : (
        <p role="status" className="bg-muted rounded-md px-3 py-2 font-sans text-sm print:hidden">
          {t('offline.banner', { time: assembled })}
        </p>
      )}
      <div
        role="toolbar"
        aria-label={t('actions.bar')}
        className="bg-background/95 sticky top-0 z-10 flex flex-wrap items-center gap-3 py-2 print:hidden"
      >
        <ReadinessMeter
          score={readiness.score}
          segments={segments}
          label={t('readiness.label', { score: readiness.score })}
        />
        <PreparedControl
          workspaceId={view.workspaceId}
          listingId={brief.listing_id}
          prepared={brief.prepared}
          members={view.members}
          staleCleared={view.staleCleared}
          canWrite={view.canWrite}
          offline={!online}
        />
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={print}>
            {t('actions.print')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href).then(() => {
                setCopied(true);
              });
            }}
          >
            {t('actions.share')}
          </Button>
        </div>
      </div>
      <SectionIndex sections={keys} />
      {copied ? (
        <p role="status" className="font-sans text-sm print:hidden">
          {t('actions.shared')}
        </p>
      ) : null}
      <SheetPage>
        <Masthead masthead={view.masthead} assembledAt={view.assembledAt} />
        {isEmptyBrief(brief) ? (
          <div className="grid gap-1 py-6">
            <h2 className="font-serif text-lg">{t('empty.title')}</h2>
            <p className="text-muted-foreground">{t('empty.body')}</p>
          </div>
        ) : null}
        <Sections
          workspaceId={view.workspaceId}
          listingId={brief.listing_id}
          brief={brief}
          keys={keys}
          members={view.members}
          canWrite={view.canWrite}
          offline={!online}
          printNotes={printNotes}
          onPrintNotes={setPrintNotes}
        />
      </SheetPage>
      {view.canWrite ? null : (
        <p className="text-muted-foreground text-center font-sans text-sm print:hidden">
          {t('viewer.readOnly')}
        </p>
      )}
      {dialog}
    </div>
  );
}
