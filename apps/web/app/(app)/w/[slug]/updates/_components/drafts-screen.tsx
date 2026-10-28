'use client';
// Binds the drafts screen (#736) to the outward server actions and the router. Preparing a draft
// in another language composes a new draft from the same records; nothing here sends anything.
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { FactLine } from '../../../../../../components/drafting/editor.tsx';
import {
  DraftsWorkspace,
  type DraftCardView,
} from '../../../../../../components/outward/draft-list.tsx';
import type { DraftView } from '../../../../../../components/outward/draft-editor.tsx';
import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import { singleTextRunner, useFactCheck } from '../../../../../../lib/drafting/use-fact-check.ts';
import { checkFactsLiveAction } from '../../drafts/[id]/factcheck-actions.ts';
import {
  composeDraftAction,
  markDraftSharedAction,
  saveDraftEditAction,
} from '../../_outward/actions.ts';

export interface DraftsScreenProps {
  workspaceId: string;
  drafts: DraftCardView[];
  open: DraftView | null;
  readOnly: boolean;
  forceOffline: boolean;
}

export function DraftsScreen({
  workspaceId,
  drafts,
  open,
  readOnly,
  forceOffline,
}: DraftsScreenProps) {
  const t = useTranslations('outward');
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnline();
  const offline = forceOffline || !online;
  // Live fact-check (#916) of the draft as typed; the saved text stands in until the first edit.
  const [typed, setTyped] = useState<{ id: string; body: string } | null>(null);
  const text = typed !== null && typed.id === open?.id ? typed.body : (open?.body ?? '');
  const blocks = useMemo(() => [{ key: 'text', text }], [text]);
  const run = useMemo(
    () => singleTextRunner(checkFactsLiveAction, workspaceId, open?.matterId ?? null),
    [workspaceId, open?.matterId ?? null],
  );
  const facts = useFactCheck({
    matterId: open?.matterId ?? null,
    blocks,
    run,
    enabled: !offline && open !== null,
  });
  return (
    <div data-route="updates" className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <DraftsWorkspace
        drafts={drafts}
        open={open}
        offline={offline}
        readOnly={readOnly}
        onOpen={(id) => {
          router.replace(id === null ? pathname : `${pathname}?draft=${id}`);
        }}
        onBodyChange={(id, body) => {
          setTyped({ id, body });
        }}
        onSave={async (draftId, body) => {
          const result = await saveDraftEditAction({ workspaceId, draftId, body });
          if (result.ok) router.refresh();
          return { ok: result.ok, warnings: result.ok ? result.data.warnings : [] };
        }}
        onShared={async (draftId, channel) => {
          const result = await markDraftSharedAction({ workspaceId, draftId, channel });
          if (result.ok) router.refresh();
          return result.ok;
        }}
        onLanguageChange={(_draftId, language) => {
          if (open === null) return;
          void composeDraftAction({
            workspaceId,
            matterId: open.matterId,
            audience: open.audience,
            language,
          }).then((result) => {
            if (result.ok) router.replace(`${pathname}?draft=${result.data.draftId}`);
          });
        }}
      />
      {open === null ? null : (
        <FactLine text={text} verdicts={facts.verdicts} facts={{ verdicts: facts.verdicts }} />
      )}
    </div>
  );
}
