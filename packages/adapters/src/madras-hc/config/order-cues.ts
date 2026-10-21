// Madras HC order cues (#395, #398): the phrases `findDirectionCues`, the order-header reader and the
// registry-notice reader look for, lower-case. Absolute cues carry a date only when the literal is
// printed; relative and time-bound ones stay unresolved for the extractor (#46).

export const ABSOLUTE_DATE_PHRASES = ['post on', 'call on', 'list on'] as const;
export const RELATIVE_DATE_PHRASES = ['list after', 'post the matter after', 'post after'] as const;
/** Only a cue when followed by a duration (`within two weeks`, `within 10 days`). */
export const TIME_BOUND_PHRASES = ['within'] as const;
export const NOTICE_PHRASES = ['issue notice', 'notice returnable'] as const;
export const RESERVED_PHRASES = [
  'orders reserved',
  'reserved for orders',
  'judgment reserved',
] as const;
export const DISPENSED_PHRASES = ['dispensed'] as const;
export const OTHER_DIRECTION_PHRASES = [
  ...NOTICE_PHRASES,
  ...RESERVED_PHRASES,
  ...DISPENSED_PHRASES,
] as const;

export const DIRECTION_PHRASES: string[] = [
  ...ABSOLUTE_DATE_PHRASES,
  ...RELATIVE_DATE_PHRASES,
  ...TIME_BOUND_PHRASES,
  ...OTHER_DIRECTION_PHRASES,
];

/** Order-type cues, checked in this order; `judgment` is read from the order's title line only. */
export const ORDER_TYPE_CUES: readonly {
  type: 'judgment' | 'final' | 'interim';
  phrases: string[];
}[] = [
  { type: 'judgment', phrases: ['common judgment', 'judgment'] },
  { type: 'final', phrases: ['disposed of', 'dismissed', 'allowed', 'closed'] },
  { type: 'interim', phrases: ['interim', 'till the next hearing', 'ad-interim'] },
];

/**
 * Words that introduce a reference to an earlier order (`order dated 03.03.2019`): a date right
 * after one is never the order date or a next date.
 */
export const EARLIER_ORDER_PREFIXES = [
  'order dated',
  'orders dated',
  'judgment dated',
  'dated',
  'vide order',
  'by order of',
] as const;

/** Registry-notice phrases (SR numbers, returns, re-presentation, numbering), lower-case. */
export const REGISTRY_PHRASES = {
  returned: ['returned for rectification', 'returned for defects', 'defects', 'seat for returns'],
  rePresent: ['re-present', 're-presented', 'represent'],
  numbered: ['numbered as'],
} as const;
