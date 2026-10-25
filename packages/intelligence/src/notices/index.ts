// Official notices (#585, D-048): per-source parsers into typed notices and schema-validated
// kind and forum tagging. Polling, storage and matching are #586.
export {
  KARNATAKA_HC_NOTICES_SOURCE_ID,
  KARNATAKA_HC_NOTICE_CONFIG,
  parseKarnatakaHcNotices,
} from './parse-karnataka-hc.ts';
export {
  MADRAS_HC_NOTICES_SOURCE_ID,
  MADRAS_HC_NOTICE_CONFIG,
  parseMadrasHcNotices,
} from './parse-madras-hc.ts';
export { parseNoticeListLines, parseNoticeListPdf } from './parse-pdf-list.ts';
export {
  NOTICE_TEXT_CHARS,
  NoticeTagSchema,
  tagNotice,
  type NoticeTag,
  type TagNoticeDeps,
  type TagNoticeInput,
} from './tag.ts';
export {
  effectiveOnFromTitle,
  kindFromTitle,
  parseNoticeTableHtml,
  type NoticeParseResult,
  type NoticeSourceConfig,
  type ParsedNotice,
} from './types.ts';
export {
  parseHolidayListHtml,
  parseHolidayListLines,
  parseHolidayListPdf,
  parseHolidayListText,
  type HolidayDate,
} from './parse-holiday-list.ts';
