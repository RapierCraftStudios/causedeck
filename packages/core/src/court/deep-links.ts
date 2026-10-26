// Official deep links (#34, ADR 0014). A forum's `config.deepLinks` holds templates: a path relative
// to the forum's hosts, or an absolute https URL on one of them. The result is always a link the
// lawyer opens in a new window: Madras HC forbids framing, so there is no embeddable variant, and the
// product never fetches these pages. Hosts come from the catalogue only; none is written here.
import {
  templateHost,
  type ForumConfig,
  type ForumDeepLinkKind,
} from '@causedeck/validators/forum';

import { invalid } from '../shared/errors.ts';

/** How a deep link is opened: a new browsing context, without opener access or a referrer. */
export interface OpenInNewWindow {
  url: string;
  /** The same page on the forum's other hosts, in catalogue order (empty for an absolute link). */
  fallbacks: string[];
  target: '_blank';
  rel: 'noopener noreferrer';
}

export type DeepLinkParams = Readonly<Record<string, string | number>>;

/** Replace each `{name}` with its URL-encoded parameter; a missing parameter is a VALIDATION error. */
export function interpolateTemplate(template: string, params: DeepLinkParams = {}): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw invalid(`Missing deep-link parameter: ${name}`);
    return encodeURIComponent(String(value));
  });
}

/** The `kind` link of a forum config, or null when the forum has no such page. */
export function buildDeepLink(
  config: ForumConfig,
  kind: ForumDeepLinkKind,
  params: DeepLinkParams = {},
): OpenInNewWindow | null {
  const template = config.deepLinks[kind];
  if (template === undefined) return null;
  const resolved = interpolateTemplate(template, params);
  const urls =
    templateHost(template) === undefined
      ? config.hosts.map((host) => `https://${host}/${resolved.replace(/^\/+/, '')}`)
      : [resolved];
  const [url, ...fallbacks] = urls;
  if (url === undefined) return null;
  return { url, fallbacks, target: '_blank', rel: 'noopener noreferrer' };
}
