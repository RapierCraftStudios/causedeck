// The official notices domain (#586, part 3 of #480, D-048): the poll of cleared notice sources
// through the governed fetch layer, notices stored once with provenance, and their matching to the
// workspaces and matters that use the forums they name. Alerts (#587) and the page (#588) read it.
export {
  NOTICE_PARSERS,
  pollNotices,
  type NoticeFetcher,
  type NoticeParser,
  type PollNoticesDeps,
  type PollNoticesReport,
} from './poll.ts';
export { matchNotices, type MatchNoticesReport, type NoticeToMatch } from './match.ts';
export {
  listMatterNotices,
  listWorkspaceNotices,
  NOTICES_LIST_LIMIT,
  type NoticeActor,
  type NoticeRow,
} from './list.ts';
