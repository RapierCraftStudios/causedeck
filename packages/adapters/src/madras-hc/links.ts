// Official deep links for an adapter (#395), from the forum's catalogue config (ADR 0014): the same
// template rules as core's `buildDeepLink` (packages/core/src/court/deep-links.ts). A relative
// template is opened on every catalogue host in order, the first preferred; an absolute https
// template is used as is. Links open in a new window and are never fetched; hosts are data only.
import { DeepLinkSchema, type DeepLink, type DeepLinkParams } from '../types.ts';

/** The part of a forum's `config` an adapter needs to build links (structurally `ForumConfig`). */
export interface ForumLinkConfig {
  hosts: readonly string[];
  deepLinks: Readonly<Partial<Record<string, string>>>;
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The `kind` link of a forum config; null without such a page or with a parameter missing. */
export function resolveForumLink(
  config: ForumLinkConfig,
  kind: string,
  params: DeepLinkParams = {},
): DeepLink | null {
  const template = config.deepLinks[kind];
  if (template === undefined) return null;
  // An absolute template must be https; any other scheme is refused, never rewritten.
  if (/^[a-z][a-z0-9+.-]*:/i.test(template) && !/^https:\/\//.test(template)) return null;
  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
  if (names.some((name) => params[name] === undefined)) return null;
  const resolved = template.replace(PLACEHOLDER, (_match, name: string) =>
    encodeURIComponent(params[name] ?? ''),
  );
  const urls = /^https:\/\//.test(template)
    ? [resolved]
    : config.hosts.map((host) => `https://${host}/${resolved.replace(/^\/+/, '')}`);
  const [url, ...fallbacks] = urls;
  if (url === undefined) return null;
  const link = DeepLinkSchema.safeParse({
    url,
    fallbacks,
    target: '_blank',
    rel: 'noopener noreferrer',
  });
  return link.success ? link.data : null;
}
