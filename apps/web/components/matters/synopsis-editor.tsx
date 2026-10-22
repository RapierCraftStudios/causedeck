'use client';
// The synopsis note (#390, #40 design spec): a few lines the lawyer writes about the matter,
// always provenance `manual` ("Written by hand"). Members who may write the matter edit it in
// place (`Edit synopsis`, Save, Cancel); saving an empty note clears it. `updateMatterAction` checks
// `matter.write` again. Roles without `strategy.read` (clerks, viewers below junior) never receive
// the text: the card is replaced by the permission-denied state. Offline, saving is off.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { PermissionDenied } from '@causedeck/ui/patterns';
import { Textarea } from '@causedeck/ui/textarea';
import { PencilLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';

export type UpdateMatterAction = (input: {
  workspaceId: string;
  matterId: string;
  patch: { title?: string; synopsis?: string | null };
}) => Promise<Result<{ id: string; title: string; synopsis: string | null }>>;

export interface SynopsisEditorProps {
  workspaceId: string;
  matterId: string;
  synopsis: string | null;
  /** The role lacks `strategy.read`: the permission-denied state instead of the card. */
  denied: boolean;
  canWrite: boolean;
  offline?: boolean;
  action: UpdateMatterAction;
}

export function SynopsisEditor({
  workspaceId,
  matterId,
  synopsis,
  denied,
  canWrite,
  offline = false,
  action,
}: SynopsisEditorProps) {
  const t = useTranslations('matters.workspace');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(synopsis ?? '');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleId = `${id}-title`;

  if (denied) {
    return (
      <section aria-labelledby={titleId} data-slot="synopsis" data-synopsis="denied">
        <h2 id={titleId} className="text-ink-muted text-sm font-medium">
          {t('synopsis.title')}
        </h2>
        <PermissionDenied message={t('synopsis.denied')} />
      </section>
    );
  }

  function startEditing() {
    setDraft(synopsis ?? '');
    setFailed(false);
    setEditing(true);
  }

  async function onSave(event: SyntheticEvent) {
    event.preventDefault();
    if (pending || offline) return;
    setPending(true);
    setFailed(false);
    let result: Result<{ id: string; title: string; synopsis: string | null }>;
    try {
      const text = draft.trim();
      result = await action({
        workspaceId,
        matterId,
        patch: { synopsis: text === '' ? null : text },
      });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setEditing(false);
    announce(t('synopsis.announceSaved'));
    router.refresh();
  }

  let body;
  if (editing) {
    body = (
      <form noValidate className="flex flex-col gap-3" onSubmit={(event) => void onSave(event)}>
        <Textarea
          aria-label={t('synopsis.label')}
          data-synopsis-input=""
          rows={6}
          maxLength={20_000}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        {offline ? (
          <Alert tone="warning" role="status">
            {t('offlineAction')}
          </Alert>
        ) : null}
        {failed ? (
          <Alert tone="danger" role="alert">
            {t('synopsis.failed')}
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button
            type="submit"
            data-synopsis-save=""
            loading={pending}
            disabled={pending || offline}
          >
            {t('synopsis.save')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditing(false);
            }}
          >
            {t('synopsis.cancel')}
          </Button>
        </div>
      </form>
    );
  } else if (synopsis === null) {
    body = (
      <EmptyState
        data-pattern-state="empty"
        data-synopsis="empty"
        icon={<PencilLine />}
        title={t('synopsis.empty')}
        description={t('synopsis.emptyBody')}
        action={
          canWrite ? (
            <Button type="button" variant="secondary" disabled={offline} onClick={startEditing}>
              {t('synopsis.write')}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <p data-synopsis-text="" className="text-sm leading-6 whitespace-pre-wrap">
          {synopsis}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-muted text-xs">{t('synopsis.manual')}</span>
          {canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-synopsis-edit=""
              disabled={offline}
              onClick={startEditing}
            >
              {t('synopsis.edit')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      data-slot="synopsis"
      className="border-line bg-surface flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id={titleId} className="text-ink-muted text-sm font-medium">
        {t('synopsis.title')}
      </h2>
      {body}
    </section>
  );
}
