'use client';
// The Handover button and sheet (#71): the latest saved note, the derived draft to edit and save
// (an immutable numbered version addressed to a member), history, and Acknowledge for the recipient.
// Keys: `h` opens, Cmd/Ctrl+Enter saves, Esc closes. States: loading, error with retry, denied,
// offline (the last note from this device), empty. Internal only: no share, email or export.
import { Button } from '@causedeck/ui/button';
import { HandoverSkeleton } from '@causedeck/ui/patterns';
import type { HandoverNote } from '@causedeck/validators';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';

import {
  acknowledgeHandoverAction,
  generateHandoverAction,
  listHandoversAction,
  saveHandoverAction,
} from './actions.ts';
import { HandoverHistory } from './handover-history.tsx';
import { HandoverNoteView } from './handover-view.tsx';

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'denied' }
  | { state: 'ready'; notes: HandoverNote[]; offline: boolean };

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export interface HandoverSheetProps {
  workspaceId: string;
  matterId: string;
  /** Member names by member id, for the recipient picker and history. */
  members: Record<string, string>;
  /** The viewer's member id: only the recipient may acknowledge. */
  myMemberId: string | null;
  canWrite: boolean;
}

export function HandoverSheet({
  workspaceId,
  matterId,
  members,
  myMemberId,
  canWrite,
}: HandoverSheetProps) {
  const t = useTranslations('continuity.handover');
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');
  const [questions, setQuestions] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const cacheKey = `handover:${matterId}`;

  const fetchNotes = useCallback(() => {
    setLoad({ state: 'loading' });
    void listHandoversAction({ workspaceId, matterId }).then((res) => {
      if (res.ok) {
        localStorage.setItem(cacheKey, JSON.stringify(res.data));
        setLoad({ state: 'ready', notes: res.data, offline: false });
      } else if (res.error.code === 'FORBIDDEN') {
        setLoad({ state: 'denied' });
      } else {
        setLoad({ state: 'error' });
      }
    });
  }, [workspaceId, matterId, cacheKey]);

  const show = useCallback(() => {
    setOpen(true);
    setMessage(null);
    if (!navigator.onLine) {
      const cached = localStorage.getItem(cacheKey);
      setLoad({
        state: 'ready',
        notes: cached === null ? [] : (JSON.parse(cached) as HandoverNote[]),
        offline: true,
      });
      return;
    }
    fetchNotes();
  }, [cacheKey, fetchNotes]);

  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (e.key === 'h' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !open) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, show]);

  const save = () => {
    if (recipient === '' || !online) return;
    start(async () => {
      const res = await saveHandoverAction({
        workspaceId,
        matterId,
        recipientMemberId: recipient,
        edits: notes.trim() === '' ? {} : { where_it_stands: notes.trim() },
        openQuestions: questions
          .split('\n')
          .map((q) => q.trim())
          .filter(Boolean),
      });
      if (res.ok) {
        setMessage(t('saved', { version: res.data.version }));
        setNotes('');
        setQuestions('');
        fetchNotes();
      } else {
        setMessage(t('saveFailed'));
      }
    });
  };

  const acknowledge = (note: HandoverNote) => {
    start(async () => {
      const res = await acknowledgeHandoverAction({ workspaceId, handoverId: note.id });
      if (res.ok) fetchNotes();
    });
  };

  const latest = load.state === 'ready' ? load.notes[0] : undefined;
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={show} aria-keyshortcuts="h">
        {t('button')}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="handover-title"
        className="bg-background text-foreground max-h-[90dvh] w-[min(40rem,100vw-1rem)] overflow-y-auto rounded-md border p-4"
        onClose={() => {
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
      >
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="handover-title" className="font-serif text-lg">
              {t('title')}
            </h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => dialog.current?.close()}>
              {t('close')}
            </Button>
          </div>
          {load.state === 'loading' ? <HandoverSkeleton label={t('loading')} /> : null}
          {load.state === 'denied' ? <p role="alert">{t('denied')}</p> : null}
          {load.state === 'error' ? (
            <div role="alert" className="grid gap-2">
              <p>{t('error')}</p>
              <Button type="button" size="sm" onClick={fetchNotes}>
                {t('retry')}
              </Button>
            </div>
          ) : null}
          {load.state === 'ready' ? (
            <>
              {load.offline ? (
                <p role="status" className="bg-muted rounded-md px-3 py-2 text-sm">
                  {latest === undefined ? t('offlineNone') : t('offline')}
                </p>
              ) : null}
              {latest === undefined ? (
                <div className="grid gap-1">
                  <h3 className="font-medium">{t('empty')}</h3>
                  <p className="text-muted-foreground text-sm">{t('emptyHint')}</p>
                </div>
              ) : (
                <HandoverNoteView
                  note={latest}
                  canAcknowledge={
                    latest.recipient_id !== null && latest.recipient_id === myMemberId
                  }
                  onAcknowledge={() => {
                    acknowledge(latest);
                  }}
                />
              )}
              <HandoverHistory notes={load.notes.slice(1)} members={members} />
              {canWrite && !load.offline ? (
                <form
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                >
                  <label className="grid gap-1 text-sm">
                    {t('recipient')}
                    <select
                      value={recipient}
                      onChange={(e) => {
                        setRecipient(e.target.value);
                      }}
                      className="border-line min-h-11 rounded-md border px-2"
                    >
                      <option value="">{t('recipientNone')}</option>
                      {Object.entries(members).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    {t('edit')}
                    <textarea
                      value={notes}
                      onChange={(e) => {
                        setNotes(e.target.value);
                      }}
                      rows={3}
                      className="border-line rounded-md border p-2"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    {t('questions')}
                    <textarea
                      value={questions}
                      onChange={(e) => {
                        setQuestions(e.target.value);
                      }}
                      rows={3}
                      className="border-line rounded-md border p-2"
                    />
                  </label>
                  <Button type="submit" disabled={recipient === '' || pending}>
                    {pending ? t('pending') : t('save')}
                  </Button>
                </form>
              ) : null}
              {message === null ? null : (
                <p role="status" className="text-sm">
                  {message}
                </p>
              )}
            </>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
