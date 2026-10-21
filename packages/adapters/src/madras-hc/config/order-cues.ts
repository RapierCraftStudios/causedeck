// Madras HC order cues (#395): the phrases `findDirectionCues` and the order-type reader (#398) look
// for, lower-case. Absolute cues carry a date only when the literal is printed; relative ones stay
// unresolved for the extractor (#46).

export const ABSOLUTE_DATE_PHRASES = ['post on', 'call on', 'list on'] as const;
export const RELATIVE_DATE_PHRASES = ['list after', 'post the matter after', 'post after'] as const;
export const TIME_BOUND_PHRASES = ['within'] as const;
export const OTHER_DIRECTION_PHRASES = ['issue notice', 'orders reserved', 'dispensed'] as const;

export const DIRECTION_PHRASES: string[] = [
  ...ABSOLUTE_DATE_PHRASES,
  ...RELATIVE_DATE_PHRASES,
  ...TIME_BOUND_PHRASES,
  ...OTHER_DIRECTION_PHRASES,
];

/** Order-type cues, checked in this order. */
export const ORDER_TYPE_CUES: readonly {
  type: 'judgment' | 'final' | 'interim';
  phrases: string[];
}[] = [
  { type: 'judgment', phrases: ['common judgment', 'judgment'] },
  { type: 'final', phrases: ['disposed of', 'dismissed', 'allowed', 'closed'] },
  { type: 'interim', phrases: ['interim', 'till the next hearing', 'ad-interim'] },
];
