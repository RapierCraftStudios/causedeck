'use client';
// The paste-text capture sheet (#1074): paste or type text, Save. It goes through the same capture
// pipeline as voice and camera (a `manual` capture: stored raw, queued, read by the pipeline, and
// anything it finds lands in the inbox as a proposal for the member to confirm). Needs a
// connection: unlike a recording there is nothing to keep on the device, so offline the Save
// button is off and the sheet says why. A bottom sheet on phones, a dialog on wider screens.
import { Alert, AlertDescription } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { Textarea } from '@causedeck/ui/textarea';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useState, useSyncExternalStore } from 'react';

import { pasteTextCaptureAction } from '../../../app/(app)/w/[slug]/inbox/actions.ts';
import { PASTE_QUERY_KEY, wantsPaste } from '../../../lib/capture/paste/query.ts';

/** Matches the server action's limit. */
export const PASTE_MAX_CHARS = 20_000;

type Phase = 'edit' | 'saving' | 'saved';
type ErrorKey = 'forbidden' | 'channelOff' | 'tooLong' | 'generic';

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

export interface PasteTextSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Called once the text is saved as a capture. */
  onSaved?: (() => void) | undefined;
}

export function PasteTextSheet({ open, onOpenChange, workspaceId, onSaved }: PasteTextSheetProps) {
  const t = useTranslations('shell.pasteText');
  const fieldId = useId();
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [error, setError] = useState<ErrorKey | null>(null);

  const trimmed = text.trim();
  const canSave = online && phase === 'edit' && trimmed !== '' && trimmed.length <= PASTE_MAX_CHARS;

  async function save() {
    if (!canSave) return;
    setError(null);
    setPhase('saving');
    try {
      const result = await pasteTextCaptureAction({ workspaceId, text: trimmed });
      if (result.ok && result.data.error === undefined) {
        setPhase('saved');
        onSaved?.();
        return;
      }
      if (result.ok) setError(result.data.error ?? 'generic');
      else setError(result.error.code === 'FORBIDDEN' ? 'forbidden' : 'generic');
    } catch {
      setError('generic');
    }
    setPhase('edit');
  }

  function reset() {
    setText('');
    setPhase('edit');
    setError(null);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" data-capture-paste="" labels={{ close: t('close') }}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {phase === 'saved' ? (
          <div className="flex flex-col gap-3 p-4" data-slot="paste-saved">
            <p role="status" className="text-ink text-sm">
              {t('saved')}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="min-h-11" onClick={reset}>
                {t('another')}
              </Button>
              <Button
                className="min-h-11"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {t('done')}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label htmlFor={fieldId} className="text-sm font-medium">
              {t('label')}
            </label>
            <Textarea
              id={fieldId}
              value={text}
              rows={8}
              maxLength={PASTE_MAX_CHARS}
              disabled={phase === 'saving'}
              placeholder={t('placeholder')}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
            {online ? null : (
              <Alert tone="warning">
                <AlertDescription>{t('offline')}</AlertDescription>
              </Alert>
            )}
            {error ? (
              <Alert tone="danger">
                <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
              </Alert>
            ) : null}
            <p className="text-ink-muted text-xs">{t('privacy')}</p>
            <Button
              type="submit"
              className="min-h-11 self-start"
              disabled={!canSave}
              aria-busy={phase === 'saving' || undefined}
            >
              {t('save')}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Opens the paste sheet when the URL says `?capture=paste` (the capture sheet's `Paste text`) and
 * drops the parameter when it closes. Mounted lazily by the shell.
 */
export function PasteHost({ workspaceId }: { workspaceId: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  if (!wantsPaste(params)) return null;
  return (
    <PasteTextSheet
      open
      workspaceId={workspaceId}
      onSaved={() => {
        router.refresh();
      }}
      onOpenChange={(next) => {
        if (next) return;
        const rest = new URLSearchParams(params.toString());
        rest.delete(PASTE_QUERY_KEY);
        const query = rest.toString();
        router.replace(query === '' ? pathname : `${pathname}?${query}`);
      }}
    />
  );
}
