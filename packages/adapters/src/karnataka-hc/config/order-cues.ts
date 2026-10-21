// Karnataka HC order cues (#404, #406): the phrases `findDirectionCues` and the order-header reader
// look for, lower-case. Absolute cues carry a date only when the literal is printed; relative and
// time-bound ones stay unresolved for the extractor (#46).

/** The adapter's `orderParser.directionPhrases` (also in `adapter.config.json`). */
export const KARNATAKA_HC_DIRECTION_PHRASES: string[] = [
  'list on',
  'post on',
  'call on',
  'list after',
  'list the matter after',
  'post after',
  'adjourned to',
  'within',
  'issue notice',
  'rule',
  'orders reserved',
];

export const KARNATAKA_HC_ABSOLUTE_DATE_PHRASES = [
  'list on',
  'post on',
  'call on',
  'adjourned to',
] as const;
export const KARNATAKA_HC_RELATIVE_DATE_PHRASES = [
  'list after',
  'list the matter after',
  'post after',
] as const;
/** Only a cue when followed by a duration (`within four weeks`, `within 10 days`). */
export const KARNATAKA_HC_TIME_BOUND_PHRASES = ['within'] as const;
export const KARNATAKA_HC_NOTICE_PHRASES = ['issue notice'] as const;
export const KARNATAKA_HC_RULE_PHRASES = ['rule'] as const;
export const KARNATAKA_HC_RESERVED_PHRASES = ['orders reserved'] as const;

/**
 * Words that introduce a reference to an earlier or impugned order (`impugned order dated
 * 03.03.2019`): a date right after one is never the order date or a next date.
 */
export const KARNATAKA_HC_EARLIER_ORDER_PREFIXES = [
  'impugned order dated',
  'impugned judgment dated',
  'order dated',
  'orders dated',
  'judgment dated',
  'dated',
  'passed on',
  'vide order',
] as const;

/** Order-type cues, checked in this order; `judgment` is read from the order's title line only. */
export const KARNATAKA_HC_ORDER_TYPE_CUES: readonly {
  type: 'judgment' | 'final' | 'interim';
  phrases: string[];
}[] = [
  { type: 'judgment', phrases: ['common judgment', 'judgment'] },
  { type: 'final', phrases: ['disposed of', 'dismissed', 'allowed'] },
  { type: 'interim', phrases: ['interim', 'till the next date of hearing', 'ad-interim'] },
];
