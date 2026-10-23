// The ListUnreadable signal (#369): typed `{forumCode, hallNo?, deepLink}` whose link is the
// forum's official cause list from #34's `resolveDeepLink`, opening in a new window.
import { describe, expect, it } from 'vitest';

import { buildListUnreadable, ListUnreadableSchema, type ResolveDeepLink } from '../index.ts';

const forum = {
  code: 'test.echo.principal',
  enabled: true,
  config: { hosts: ['echo.example'], deepLinks: { cause_list: 'list?d={date}' } },
};

/** Mirrors core's resolveDeepLink for this config (adapters may not import core). */
const resolveDeepLink: ResolveDeepLink = (target, kind, params = {}) => {
  if (!target.enabled) return null;
  const config = target.config as { hosts: string[]; deepLinks: Record<string, string> };
  const template = config.deepLinks[kind];
  if (template === undefined) return null;
  const path = template.replace(/\{(\w+)\}/g, (_m, name: string) =>
    encodeURIComponent(String(params[name] ?? '')),
  );
  const [url, ...fallbacks] = config.hosts.map((host) => `https://${host}/${path}`);
  return url === undefined
    ? null
    : { url, fallbacks, target: '_blank', rel: 'noopener noreferrer' };
};

describe('buildListUnreadable', () => {
  it('returns the typed signal with a new-window official link', () => {
    const calls: unknown[] = [];
    const signal = buildListUnreadable(
      { forum, hallNo: '5', params: { date: '2026-10-21' } },
      (target, kind, params) => {
        calls.push([kind, params]);
        return resolveDeepLink(target, kind, params);
      },
    );
    expect(ListUnreadableSchema.parse(signal)).toEqual({
      kind: 'list_unreadable',
      forumCode: 'test.echo.principal',
      hallNo: '5',
      deepLink: {
        url: 'https://echo.example/list?d=2026-10-21',
        fallbacks: [],
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    });
    expect(calls).toEqual([['cause_list', { date: '2026-10-21' }]]);
  });

  it('omits the hall and carries a null link when the forum has none', () => {
    expect(buildListUnreadable({ forum: { ...forum, enabled: false } }, resolveDeepLink)).toEqual({
      kind: 'list_unreadable',
      forumCode: 'test.echo.principal',
      deepLink: null,
    });
  });

  it('refuses a link that does not open in a new window', () => {
    expect(() =>
      buildListUnreadable({ forum }, () => ({
        url: 'https://echo.example/list',
        fallbacks: [],
        target: '_self' as '_blank',
        rel: 'noopener noreferrer',
      })),
    ).toThrow();
  });
});
