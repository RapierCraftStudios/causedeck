// `/share-target` (#50): where the Android share sheet lands. The service worker takes the POST,
// writes the files to the encrypted outbox on the device and redirects here with `?batch=<id>`; this
// page only reads. It works signed out too (the files wait on the device and the person is asked to
// sign in, after which they are attributed to that session) and asks for the workspace when the
// member has several (`?ws=<id>`). Channel state and the matter hint list are read in the member's
// own workspace scope; enabling a channel reuses the inbox action (`workspace.manage`).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  ShareTargetScreen,
  type ShareMatter,
  type ShareWorkspace,
} from '../../components/pwa/share-target-screen.tsx';
import { loadMatterList } from '../../lib/matters/graph-deps.ts';
import { signInPathFor } from '../../lib/safe-next.ts';
import { can, type Membership } from '../../lib/workspace-context.ts';
import { loadMemberships } from '../../lib/workspace-loader.ts';
import { enableChannelAction } from '../(app)/w/[slug]/inbox/actions.ts';

export const dynamic = 'force-dynamic';

interface ShareTargetPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATTER_HINT_LIMIT = 25;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pwa.share');
  return { title: t('metaTitle') };
}

function first(value: string | string[] | undefined): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  return one === undefined || one === '' ? null : one;
}

async function loadShareState(
  memberships: readonly Membership[],
  userId: string,
): Promise<{ workspaces: ShareWorkspace[]; disclosureVersion: string }> {
  // Imported one after the other: concurrent dynamic imports of core race the test mocks.
  const runtime = await import('@causedeck/core/runtime');
  const { listChannels, CAPTURE_DISCLOSURE_VERSION } = await import('@causedeck/core/capture');
  const workspaces = await Promise.all(
    memberships.map(async ({ workspace, role }) => {
      const scope = { workspaceId: workspace.id, userId };
      const states = await runtime.inWorkspace(scope, (tx) => listChannels(tx, workspace.id));
      return {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        shareEnabled: states.find((state) => state.channel === 'share')?.enabled ?? false,
        canManage: can(role, 'workspace.manage'),
      };
    }),
  );
  return { workspaces, disclosureVersion: CAPTURE_DISCLOSURE_VERSION };
}

export default async function ShareTargetPage({ searchParams }: ShareTargetPageProps) {
  const query = await searchParams;
  const rawBatch = first(query.batch);
  const batchId = rawBatch !== null && UUID.test(rawBatch) ? rawBatch : null;
  const rawError = first(query.error);
  const error = rawError === 'full' || rawError === 'failed' ? rawError : null;
  const wanted = first(query.ws);
  const signInHref = signInPathFor(
    batchId === null ? '/share-target' : `/share-target?batch=${batchId}`,
  );

  const loaded = await loadMemberships();
  if (!loaded) {
    return (
      <ShareTargetScreen
        signedIn={false}
        signInHref={signInHref}
        batchId={batchId}
        error={error}
        workspaces={[]}
        workspaceId={null}
        matters={[]}
        disclosureVersion=""
        enableChannel={enableChannelAction}
      />
    );
  }
  if (loaded.memberships.length === 0) redirect('/onboarding');

  const { workspaces, disclosureVersion } = await loadShareState(
    loaded.memberships,
    loaded.session.user.id,
  );
  // One workspace: no question. Several: the person picks (`?ws=`), never a guess.
  const chosen =
    workspaces.length === 1
      ? workspaces[0]
      : workspaces.find((workspace) => workspace.id === wanted);

  let matters: ShareMatter[] = [];
  const membership = loaded.memberships.find(({ workspace }) => workspace.id === chosen?.id);
  if (chosen?.shareEnabled === true && membership !== undefined) {
    const result = await loadMatterList(
      {
        user: {
          id: loaded.session.user.id,
          name: loaded.session.user.name,
          email: loaded.session.user.email,
        },
        workspace: membership.workspace,
        role: membership.role,
        memberships: loaded.memberships,
      },
      { sort: 'next_date', limit: MATTER_HINT_LIMIT },
    );
    if (result.kind === 'page') {
      matters = result.page.items.map((row) => ({ id: row.id, title: row.title }));
    }
  }

  return (
    <ShareTargetScreen
      signedIn
      signInHref={signInHref}
      batchId={batchId}
      error={error}
      workspaces={workspaces}
      workspaceId={chosen?.id ?? null}
      matters={matters}
      disclosureVersion={disclosureVersion}
      enableChannel={enableChannelAction}
    />
  );
}
