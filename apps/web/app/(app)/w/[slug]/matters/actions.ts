'use server';
// Matters list server actions (#388). Both go through `workspaceAction`
// (lib/workspace-action.ts): zod input, `requireSession`, membership, and the policy action asserted
// by `guard`, so a non-member (another workspace's owner included) gets FORBIDDEN before anything
// runs. The matter-graph services run on the workspace-scoped transaction `ctx.tx` and decide again
// with `can()` from the membership row.
// - `createMatterAction`: `matter.write` (owners, advocates, juniors). The New matter dialog.
// - `searchMattersAction`: `matter.read`. The command palette's matter search (⌘K): title, party or
//   case number in any punctuation (`searchMatters` normalises it), 8 results, each with only what
//   the palette row shows (title, forum, next date, sensitive).
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { graphDeps } from '../../../../../lib/matters/graph-deps.ts';
import type { Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

const CreateMatter = WorkspaceScoped.extend({
  title: z.string().trim().min(1).max(500),
  practiceArea: z.string().trim().max(200).optional(),
  sensitive: z.boolean().optional(),
});

export interface CreatedMatter {
  id: string;
  title: string;
}

const create = workspaceAction(
  CreateMatter,
  async (input, ctx) => {
    const { createMatter } = await import('@causedeck/core/matter-graph');
    const practiceArea = input.practiceArea ?? '';
    const created = await createMatter(
      graphDeps(ctx.tx),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      {
        title: input.title,
        ...(practiceArea === '' ? {} : { practiceArea }),
        ...(input.sensitive === undefined ? {} : { sensitive: input.sensitive }),
      },
    );
    revalidatePath('/w/[slug]/matters', 'page');
    return { id: created.id, title: created.title };
  },
  { action: 'matter.write' },
);

export async function createMatterAction(raw: unknown): Promise<Result<CreatedMatter>> {
  return create(raw);
}

/** Palette search results: at most this many matters. */
const PALETTE_LIMIT = 8;

const SearchMatters = WorkspaceScoped.extend({
  q: z.string().trim().min(1).max(200),
});

export interface MatterSearchHit {
  id: string;
  title: string;
  /** The lead proceeding's court, if any. */
  forum: string | null;
  nextDate: {
    date: string;
    confirmationState: string;
    /** The date as the palette shows it, in the member's locale. */
    text: string;
  } | null;
  /** `No next date` in the member's locale, for a hit without one. */
  noNextDateText: string;
  sensitive: boolean;
}

const search = workspaceAction(
  SearchMatters,
  async (input, ctx) => {
    const { searchMatters } = await import('@causedeck/core/matter-graph');
    const { formatDate, isLocale, DEFAULT_LOCALE } = await import('@causedeck/i18n');
    const page = await searchMatters(
      graphDeps(ctx.tx),
      { workspaceId: ctx.workspaceId, userId: ctx.userId },
      { q: input.q, limit: PALETTE_LIMIT },
    );
    const requested = await getLocale();
    const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
    const t = await getTranslations('matters.palette');
    const noNextDateText = t('noNextDate');
    return page.items.map((row): MatterSearchHit => ({
      id: row.id,
      title: row.title,
      forum: row.forum?.court ?? null,
      nextDate:
        row.nextDate === null
          ? null
          : {
              date: row.nextDate.date,
              confirmationState: row.nextDate.confirmationState,
              text: formatDate(row.nextDate.date, { locale, style: 'court' }),
            },
      noNextDateText,
      sensitive: row.sensitive,
    }));
  },
  { action: 'matter.read' },
);

export async function searchMattersAction(raw: unknown): Promise<Result<MatterSearchHit[]>> {
  return search(raw);
}
