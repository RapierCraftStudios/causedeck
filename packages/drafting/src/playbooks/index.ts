// M5 playbook apply, precedent ranking and the explicit style profile (#902). Pure functions.
export {
  ANNEXURES_SECTION_ID,
  applyPlaybook,
  PRAYER_SECTION_ID,
  RANK_WEIGHTS,
  rankForNarratives,
  rankPrecedents,
  type ApplyContext,
  type ApplyResult,
  type PlaybookChange,
  type PrecedentCandidate,
  type RankQuery,
  type RankReason,
  type RankReasonCode,
  type RankedPrecedent,
} from './apply';
export {
  applyStyleSettings,
  DEFAULT_STYLE_SETTINGS,
  HEADING_STYLES,
  NUMBERINGS,
  parseStyleSettings,
  SALUTATION_BLOCK_ID,
  type PrayerWording,
  type StyleSettings,
} from './style-profile';
