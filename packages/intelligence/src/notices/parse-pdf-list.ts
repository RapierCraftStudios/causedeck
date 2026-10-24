// A notice list published as a PDF (#585): one notice per text line carrying a `dd/mm/yyyy` date,
// the rest of the line being the title. A PDF line has no link, so the notice URL is a URL printed
// on the line, else `<listUrl>#<n>` (n = the notice's 1-based position among the readable lines).
import { layoutFromPdf, normaliseDate } from '@causedeck/adapters';

import {
  absoluteUrl,
  buildNotice,
  type NoticeParseResult,
  type NoticeSourceConfig,
} from './types.ts';

const DATE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/;
const URL_TOKEN = /https?:\/\/\S+/i;
const SERIAL = /^\s*\d{1,4}[.)]\s+/;

/** Parse text lines (reading order) of a notice list. */
export function parseNoticeListLines(
  lines: readonly string[],
  config: NoticeSourceConfig,
): NoticeParseResult {
  const notices: NoticeParseResult['notices'] = [];
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    const date = DATE.exec(line);
    if (date === null) continue;
    const link = URL_TOKEN.exec(line);
    const title = line
      .replace(date[0], ' ')
      .replace(link?.[0] ?? '', ' ')
      .replace(SERIAL, '')
      .replace(/^[\s:–-]+|[\s:–-]+$/g, '');
    const notice = buildNotice(
      {
        title,
        issuedOn: normaliseDate(date[0]),
        url:
          link === null
            ? absoluteUrl(`#${String(notices.length + 1)}`, config.baseUrl)
            : absoluteUrl(link[0], config.baseUrl),
      },
      config,
    );
    if (notice === null) skipped += 1;
    else notices.push(notice);
  }
  return { notices, skipped };
}

/** Parse a notice-list PDF through its text layer. */
export async function parseNoticeListPdf(
  data: Uint8Array,
  config: NoticeSourceConfig,
): Promise<NoticeParseResult> {
  const layout = await layoutFromPdf(data);
  const lines = layout.pages.flatMap((page) =>
    page.items.length > 0 ? page.items.map((item) => item.text) : page.text.split('\n'),
  );
  return parseNoticeListLines(lines, config);
}
