// Outward drafts in the inbox's "Ready to send" (#736, #48): each prepared draft is a card with
// "Copy" and the `wa.me` / `mailto:` hand-offs the lawyer opens themselves, and "Mark as sent by
// me" records the share in the outward log. Nothing here sends: `markSent` only logs what the
// lawyer did in their own app. Importing this module registers the provider (the inbox page and
// the inbox actions import it, so the list and "mark sent" see the same registry).
import { getTranslations } from 'next-intl/server';

import { registerReadyProvider, type ReadyItem, type ReadyScope } from '../inbox/ready-providers.ts';

import { mailtoHref, whatsappHref } from './share-links.ts';

export const OUTWARD_PROVIDER_ID = 'outward';

/** The most drafts the inbox lists; the drafts page holds the rest. */
const MAX_READY = 20;

async function list(scope: ReadyScope): Promise<ReadyItem[]> {
  const [{ inWorkspace }, { getDraft, listDrafts }, t] = await Promise.all([
    import('@causedeck/core/runtime'),
    import('@causedeck/core/outward'),
    getTranslations('outward'),
  ]);
  return inWorkspace(scope, async (tx) => {
    const deps = { db: tx };
    const drafts = (await listDrafts(deps, scope)).slice(0, MAX_READY);
    const items: ReadyItem[] = [];
    // One after the other: they share the workspace transaction.
    for (const summary of drafts) {
      const draft = await getDraft(deps, scope, summary.id);
      items.push({
        id: draft.id,
        providerId: OUTWARD_PROVIDER_ID,
        title: draft.matterTitle,
        summary: `${t(`audience.${draft.audience}`)} · ${t(`language.${draft.language}Name`)}`,
        actions: [
          { id: 'copy', kind: 'copy', text: draft.body },
          {
            id: 'whatsapp',
            kind: 'open',
            app: 'WhatsApp',
            href: whatsappHref(draft.body),
          },
          {
            id: 'email',
            kind: 'open',
            app: t('share.email'),
            href: mailtoHref(t('share.emailSubject', { matter: draft.matterTitle }), draft.body),
          },
        ],
      });
    }
    return items;
  });
}

async function markSent(scope: ReadyScope, itemId: string): Promise<void> {
  const [{ inWorkspace }, { recordShared }] = await Promise.all([
    import('@causedeck/core/runtime'),
    import('@causedeck/core/outward'),
  ]);
  // The inbox does not say which hand-off was used; the lawyer's own copy-and-send is a clipboard share.
  await inWorkspace(scope, (tx) =>
    recordShared({ db: tx }, scope, { draftId: itemId, channel: 'clipboard' }),
  );
}

registerReadyProvider({ id: OUTWARD_PROVIDER_ID, list, markSent });
