'use client';
// One research note: title and body, its authorities (add, remove, pin) and delete; with no `note`
// it is the new-note form. Calls the research server actions passed in; `readOnly` (offline) shows
// the saved text without controls. Pinning is a flag on the note, never a citation in a draft.
import { Button } from '@causedeck/ui/button';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type SyntheticEvent } from 'react';

type Action = (raw: unknown) => Promise<{ ok: boolean }>;

export interface NoteActions {
  create: Action;
  update: Action;
  remove: Action;
  addAuthority: Action;
  removeAuthority: Action;
  pinAuthority: Action;
}

export interface NoteView {
  id: string;
  title: string;
  body: string;
  authorities: {
    label: string;
    citation?: string | undefined;
    url?: string | undefined;
    pinned: boolean;
  }[];
}

export interface NoteEditorProps {
  workspaceId: string;
  matterId: string;
  note?: NoteView;
  readOnly?: boolean;
  actions: NoteActions;
}

const text = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

export function NoteEditor({ workspaceId, matterId, note, readOnly, actions }: NoteEditorProps) {
  const t = useTranslations('research.notes');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const base = { workspaceId, matterId };

  function run(call: () => Promise<{ ok: boolean }>, reset?: () => void): void {
    start(async () => {
      const result = await call();
      setFailed(!result.ok);
      if (result.ok) {
        reset?.();
        router.refresh();
      }
    });
  }

  function onSave(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const fields = { title: text(data, 'title'), body: String(data.get('body') ?? '') };
    run(
      () =>
        note === undefined
          ? actions.create({ ...base, ...fields })
          : actions.update({ ...base, noteId: note.id, ...fields }),
      note === undefined
        ? () => {
            form.reset();
          }
        : undefined,
    );
  }

  function onAddAuthority(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (note === undefined) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const citation = text(data, 'citation');
    const url = text(data, 'url');
    run(
      () =>
        actions.addAuthority({
          ...base,
          noteId: note.id,
          label: text(data, 'label'),
          ...(citation === '' ? {} : { citation }),
          ...(url === '' ? {} : { url }),
        }),
      () => {
        form.reset();
      },
    );
  }

  if (readOnly && note !== undefined) {
    return (
      <article className="flex flex-col gap-1 text-sm">
        <h4 className="font-medium">{note.title}</h4>
        <p className="whitespace-pre-wrap">{note.body}</p>
      </article>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSave} className="flex flex-col gap-2">
        <label className="flex flex-col text-sm">
          {t('titleLabel')}
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={note?.title ?? ''}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          {t('bodyLabel')}
          <textarea
            name="body"
            rows={4}
            maxLength={20000}
            defaultValue={note?.body ?? ''}
            className="rounded border px-2 py-1"
          />
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? t('saving') : note === undefined ? t('add') : t('save')}
          </Button>
          {note === undefined ? null : (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                run(() => actions.remove({ ...base, noteId: note.id }));
              }}
            >
              {t('delete')}
            </Button>
          )}
        </div>
      </form>
      {note === undefined ? null : (
        <div className="flex flex-col gap-2">
          <h5 className="text-sm font-medium">{t('authoritiesHeading')}</h5>
          {note.authorities.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('authoritiesEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {note.authorities.map((authority, index) => (
                <li
                  key={`${authority.label}-${String(index)}`}
                  className="flex flex-wrap gap-2 text-sm"
                >
                  <span>
                    {authority.label}
                    {authority.citation ? ` (${authority.citation})` : ''}
                  </span>
                  {authority.url ? (
                    <a
                      href={authority.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {authority.url}
                    </a>
                  ) : null}
                  {authority.pinned ? (
                    <span className="text-muted-foreground">{t('pinned')}</span>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending}
                    title={t('pinHint')}
                    onClick={() => {
                      run(() =>
                        actions.pinAuthority({
                          ...base,
                          noteId: note.id,
                          index,
                          pinned: !authority.pinned,
                        }),
                      );
                    }}
                  >
                    {authority.pinned ? t('unpin') : t('pin')}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      run(() => actions.removeAuthority({ ...base, noteId: note.id, index }));
                    }}
                  >
                    {t('removeAuthority')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={onAddAuthority} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-sm">
              {t('authorityLabel')}
              <input name="label" required maxLength={300} className="rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col text-sm">
              {t('authorityCitation')}
              <input name="citation" maxLength={300} className="rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col text-sm">
              {t('authorityUrl')}
              <input name="url" type="url" maxLength={500} className="rounded border px-2 py-1" />
            </label>
            <Button type="submit" variant="outline" disabled={pending}>
              {t('addAuthority')}
            </Button>
          </form>
        </div>
      )}
      {failed ? (
        <p role="alert" className="text-sm text-red-600">
          {t('saveError')}
        </p>
      ) : null}
    </div>
  );
}
