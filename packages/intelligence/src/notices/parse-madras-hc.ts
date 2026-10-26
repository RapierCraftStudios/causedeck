// Madras High Court notice list (#585): a table of date and subject, the subject linking the
// notice document. Benches are the catalogue forums of `in.tn.madras-hc`.
import { parseNoticeTableHtml, type NoticeParseResult, type NoticeSourceConfig } from './types.ts';

export const MADRAS_HC_NOTICES_SOURCE_ID = 'in.tn.madras-hc.notices';

export const MADRAS_HC_NOTICE_CONFIG: Omit<NoticeSourceConfig, 'baseUrl'> = {
  defaultForumCodes: [
    'in.tn.madras-hc.principal.original',
    'in.tn.madras-hc.principal.appellate',
    'in.tn.madras-hc.madurai',
  ],
  benchKeywords: {
    madurai: 'in.tn.madras-hc.madurai',
    'principal bench': 'in.tn.madras-hc.principal.original',
    'original side': 'in.tn.madras-hc.principal.original',
    'appellate side': 'in.tn.madras-hc.principal.appellate',
  },
};

/** Parse the Madras HC notice page; `baseUrl` is the page URL, which resolves relative links. */
export function parseMadrasHcNotices(html: string, baseUrl: string): NoticeParseResult {
  return parseNoticeTableHtml(html, { ...MADRAS_HC_NOTICE_CONFIG, baseUrl });
}
