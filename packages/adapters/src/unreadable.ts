// The parse-failure signal (#369, ADR 0015). When a hall's list cannot be read the app shows
// "Couldn't read today's list for Hall X. Open the official list, or share it again." with the
// forum's official cause-list page opening in a new window. The link comes from #34's
// `resolveDeepLink` (packages/core/src/court/forums.ts), passed in by the caller: adapters may not
// import core (packages/config/eslint/boundaries.js), and core depends on adapters (spike §2).
import { ListUnreadableSchema, type DeepLink, type ListUnreadable } from './types.ts';

/** The forum fields `resolveDeepLink` reads, plus its code. */
export interface UnreadableForum {
  code: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** Core's `resolveDeepLink` satisfies this type. */
export type ResolveDeepLink = (
  target: { enabled: boolean; config: Record<string, unknown> },
  kind: 'cause_list',
  params?: Readonly<Record<string, string | number>>,
) => DeepLink | null;

export interface ListUnreadableInput {
  forum: UnreadableForum;
  hallNo?: string;
  /** Parameters for the forum's cause-list template, if it has any. */
  params?: Readonly<Record<string, string | number>>;
}

/** The typed `ListUnreadable` signal for a forum (and hall), with its official list link. */
export function buildListUnreadable(
  { forum, hallNo, params }: ListUnreadableInput,
  resolveDeepLink: ResolveDeepLink,
): ListUnreadable {
  const deepLink = resolveDeepLink(forum, 'cause_list', params ?? {});
  return ListUnreadableSchema.parse({
    kind: 'list_unreadable',
    forumCode: forum.code,
    ...(hallNo === undefined ? {} : { hallNo }),
    deepLink,
  });
}
