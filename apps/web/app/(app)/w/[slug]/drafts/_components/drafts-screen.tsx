'use client';
// Binds the drafts screen (#736) to the outward server actions and the router. Preparing a draft
// in another language composes a new draft from the same records; nothing here sends anything.
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import {
  DraftsWorkspace,
  type DraftCardView,
} from '../../../../../../components/outward/draft-list.tsx';
import type { DraftView } from '../../../../../../components/outward/draft-editor.tsx';
import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
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
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl font-medium">{t('title')}</h1>
      <DraftsWorkspace
        drafts={drafts}
        open={open}
        offline={offline}
        readOnly={readOnly}
        onOpen={(id) => {
          router.replace(id === null ? pathname : `${pathname}?draft=${id}`);
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
    </div>
  );
}
