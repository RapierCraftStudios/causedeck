// Karnataka High Court notice list (#585): a table of serial, subject (linking the notice
// document) and date. Benches are the catalogue forums of `in.ka.karnataka-hc`.
import { parseNoticeTableHtml, type NoticeParseResult, type NoticeSourceConfig } from './types.ts';

export const KARNATAKA_HC_NOTICES_SOURCE_ID = 'in.ka.karnataka-hc.notices';

export const KARNATAKA_HC_NOTICE_CONFIG: Omit<NoticeSourceConfig, 'baseUrl'> = {
  defaultForumCodes: [
    'in.ka.karnataka-hc.bengaluru',
    'in.ka.karnataka-hc.dharwad',
    'in.ka.karnataka-hc.kalaburagi',
  ],
  benchKeywords: {
    bengaluru: 'in.ka.karnataka-hc.bengaluru',
    bangalore: 'in.ka.karnataka-hc.bengaluru',
    dharwad: 'in.ka.karnataka-hc.dharwad',
    kalaburagi: 'in.ka.karnataka-hc.kalaburagi',
    gulbarga: 'in.ka.karnataka-hc.kalaburagi',
  },
};

/** Parse the Karnataka HC notice page; `baseUrl` is the page URL, which resolves relative links. */
export function parseKarnatakaHcNotices(html: string, baseUrl: string): NoticeParseResult {
  return parseNoticeTableHtml(html, { ...KARNATAKA_HC_NOTICE_CONFIG, baseUrl });
}
