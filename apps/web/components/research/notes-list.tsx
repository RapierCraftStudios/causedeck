'use client';
// The matter's research notes (#80): list with the empty, loading, error, offline (read-only) and
// permission-denied states. A note holds the lawyer's text and chosen authorities; pinning an
// authority only sets a flag on the note, it never adds a citation to a draft.
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { NoteEditor, type NoteActions, type NoteView } from './note-editor.tsx';

export type NotesState = 'ready' | 'loading' | 'error' | 'denied';

export interface NotesListProps {
  workspaceId: string;
  matterId: string;
  notes: NoteView[];
  state?: NotesState;
  actions: NoteActions;
}

function useOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => {
      setOffline(!navigator.onLine);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return offline;
}

export function NotesList({ workspaceId, matterId, notes, state = 'ready', actions }: NotesListProps) {
  const t = useTranslations('research.notes');
  const offline = useOffline();

  if (state === 'denied') {
    return (
      <p role="alert" data-slot="notes-denied" className="text-sm">
        {t('denied')}
      </p>
    );
  }
  if (state === 'loading') {
    return (
      <SkeletonGroup
        data-slot="notes-loading"
        data-pattern-state="loading"
        labels={{ loading: t('loading') }}
        className="gap-2"
      >
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </SkeletonGroup>
    );
  }
  if (state === 'error') {
    return (
      <p role="alert" data-slot="notes-error" className="text-sm text-red-600">
        {t('error')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {offline ? (
        <p role="status" data-slot="notes-offline" className="text-muted-foreground text-sm">
          {t('offline')}
        </p>
      ) : null}
      {notes.length === 0 ? (
        <p data-slot="notes-empty" className="text-muted-foreground text-sm">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border p-3">
              <NoteEditor
                workspaceId={workspaceId}
                matterId={matterId}
                note={note}
                readOnly={offline}
                actions={actions}
              />
            </li>
          ))}
        </ul>
      )}
      {offline ? null : (
        <NoteEditor workspaceId={workspaceId} matterId={matterId} actions={actions} />
      )}
    </div>
  );
}
