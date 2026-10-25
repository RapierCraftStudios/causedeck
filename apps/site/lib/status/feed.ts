// RSS 2.0 and Atom 1.0 from a verified snapshot. Only allowlisted fields are written and every
// value is XML-escaped; unverified or unavailable data gives an empty (but valid) feed.
import type { StatusSnapshot } from './model.ts';
import { verifySnapshot } from './verify.ts';

const FEED_TITLE = 'CauseDeck status';

/** Drops characters XML 1.0 forbids, then escapes the five markup characters. */
export function xmlEscape(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- stripping XML-illegal control characters.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  );
}

interface Entry {
  id: string;
  title: string;
  link: string;
  at: string;
  summary: string;
}

function entries(snapshot: StatusSnapshot | null, pageUrl: string): Entry[] {
  if (snapshot === null) return [];
  return snapshot.incidents.map((incident) => {
    const latest = incident.updates.at(-1);
    return {
      id: `${pageUrl}#${incident.id}`,
      title: `${incident.title} (${incident.state})`,
      link: pageUrl,
      at: latest?.at ?? incident.startedAt,
      summary: latest?.body ?? incident.title,
    };
  });
}

const feedUpdated = (snapshot: StatusSnapshot | null): string =>
  snapshot?.generatedAt ?? new Date(0).toISOString();

export function buildRss(snapshot: StatusSnapshot | null, pageUrl: string): string {
  const items = entries(snapshot, pageUrl).map(
    (e) =>
      `<item><title>${xmlEscape(e.title)}</title><link>${xmlEscape(e.link)}</link>` +
      `<guid isPermaLink="false">${xmlEscape(e.id)}</guid>` +
      `<pubDate>${new Date(e.at).toUTCString()}</pubDate>` +
      `<description>${xmlEscape(e.summary)}</description></item>`,
  );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>` +
    `<title>${FEED_TITLE}</title><link>${xmlEscape(pageUrl)}</link>` +
    `<description>Incidents and service status for CauseDeck</description>` +
    `<lastBuildDate>${new Date(feedUpdated(snapshot)).toUTCString()}</lastBuildDate>` +
    `${items.join('')}</channel></rss>\n`
  );
}

export function buildAtom(snapshot: StatusSnapshot | null, pageUrl: string): string {
  const items = entries(snapshot, pageUrl).map(
    (e) =>
      `<entry><id>${xmlEscape(e.id)}</id><title>${xmlEscape(e.title)}</title>` +
      `<link href="${xmlEscape(e.link)}"/><updated>${e.at}</updated>` +
      `<summary>${xmlEscape(e.summary)}</summary></entry>`,
  );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">` +
    `<id>${xmlEscape(pageUrl)}</id><title>${FEED_TITLE}</title>` +
    `<link href="${xmlEscape(pageUrl)}"/><updated>${feedUpdated(snapshot)}</updated>` +
    `${items.join('')}</feed>\n`
  );
}

/** Build-time read of status.json for the feed routes: the verified snapshot, else null. */
export async function loadVerifiedSnapshot(
  fetchFn: typeof fetch,
  url: string,
  key: string,
): Promise<StatusSnapshot | null> {
  try {
    const response = await fetchFn(url);
    if (!response.ok) return null;
    return await verifySnapshot(await response.json(), key);
  } catch {
    return null;
  }
}
