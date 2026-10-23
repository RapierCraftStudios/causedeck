// The matters entries of the command palette (#388): `New matter` (create group, `n` on the list)
// and the matter search source (⌘K: a title, a party or a case number in any punctuation, matched
// on the server by `searchMatters` with the #35 normalisers). Each hit shows the matter's forum and
// next date and opens the matter. Registered once from the shell (use-command-palette.ts), so this
// module stays tiny: the server action reference and the registry, no core, db or validators.
import { Briefcase, Scale } from 'lucide-react';

import { searchMattersAction } from '../../app/(app)/w/[slug]/matters/actions.ts';
import { commandsSnapshot, registerCommandSource, registerCommands } from '../commands/registry.ts';
import type { CommandInput, CommandSourceContext } from '../commands/types.ts';

import { matterHref, mattersHref } from './list-params.ts';

export const MATTER_SEARCH_SOURCE_ID = 'matters.search';

/** Palette hits for `query`: the forum and the next date as the row's second line. */
export async function searchMatterCommands(
  query: string,
  ctx: CommandSourceContext,
): Promise<CommandInput[]> {
  let result: Awaited<ReturnType<typeof searchMattersAction>>;
  try {
    result = await searchMattersAction({ workspaceId: ctx.workspaceId, q: query });
  } catch {
    return [];
  }
  if (!result.ok) return [];
  return result.data.map((hit) => ({
    id: `matter.${hit.id}`,
    label: hit.title,
    detail: [hit.forum, hit.nextDate?.text ?? hit.noNextDateText]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · '),
    icon: Briefcase,
    perform: (run) => {
      run.navigate(matterHref(run.slug, hit.id));
    },
  }));
}

/** Register `New matter` and the matter search, unless they already are. */
export function registerMatterCommands(): void {
  if (commandsSnapshot().some((entry) => entry.id === 'create.matter')) return;
  registerCommands('create', [
    {
      id: 'create.matter',
      labelKey: 'matters.palette.new',
      keywords: ['matter', 'case', 'add'],
      shortcut: 'n',
      icon: Scale,
      requires: 'matter.write',
      perform: (ctx) => {
        ctx.navigate(`${mattersHref(ctx.slug)}?new=1`);
      },
    },
  ]);
  registerCommandSource({
    id: MATTER_SEARCH_SOURCE_ID,
    group: 'matters',
    requires: 'matter.read',
    minQuery: 2,
    search: searchMatterCommands,
  });
}
