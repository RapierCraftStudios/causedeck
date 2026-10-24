'use client';
// The issue tags of a matter with the add form and confirm / dismiss for proposed tags (#497).
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type SyntheticEvent } from 'react';

import { addTagAction, confirmTagAction, dismissTagAction } from './actions.ts';

export interface TagView {
  id: string;
  statute: string;
  section: string;
  status: 'proposed' | 'confirmed' | 'dismissed';
}

export function ResearchTags(props: {
  workspaceId: string;
  matterId: string;
  tags: TagView[];
  canWrite: boolean;
}) {
  const t = useTranslations('matters.workspace.research');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const base = { workspaceId: props.workspaceId, matterId: props.matterId };

  function run(call: () => Promise<{ ok: boolean }>): void {
    start(async () => {
      const result = await call();
      setFailed(!result.ok);
      if (result.ok) router.refresh();
    });
  }

  function onAdd(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    };
    const section = text('section');
    const issue = text('issue');
    run(() =>
      addTagAction({
        ...base,
        statute: text('statute') ?? '',
        ...(section === undefined ? {} : { section }),
        ...(issue === undefined ? {} : { issue }),
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{t('tagsHeading')}</h3>
      {props.tags.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('tagsEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {props.tags.map((tag) => (
            <li key={tag.id} className="flex items-center gap-2 text-sm">
              <span>{`${tag.section === '' ? '' : `s. ${tag.section} `}${tag.statute}`}</span>
              <span className="text-muted-foreground">{t(`status.${tag.status}`)}</span>
              {props.canWrite && tag.status === 'proposed' ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      run(() => confirmTagAction({ ...base, tagId: tag.id }));
                    }}
                  >
                    {t('confirm')}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      run(() => dismissTagAction({ ...base, tagId: tag.id }));
                    }}
                  >
                    {t('dismiss')}
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {props.canWrite ? (
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-sm">
            {t('statute')}
            <input name="statute" required maxLength={200} className="rounded border px-2 py-1" />
          </label>
          <label className="flex flex-col text-sm">
            {t('section')}
            <input name="section" maxLength={50} className="rounded border px-2 py-1" />
          </label>
          <label className="flex flex-col text-sm">
            {t('issue')}
            <input name="issue" maxLength={500} className="rounded border px-2 py-1" />
          </label>
          <button type="submit" disabled={pending}>
            {t('add')}
          </button>
        </form>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-red-600">
          {t('saveError')}
        </p>
      ) : null}
    </div>
  );
}
