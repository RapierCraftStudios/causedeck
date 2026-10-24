// Display-board types (#493, D-048): the hall-by-hall "item now being heard" boards of the Madras HC
// and the Karnataka HC. A board row carries a hall number, the item now being heard, the hall's
// state and the items passed over: never a party, a case number or an advocate (matched-only rule).
export const BOARD_STATUSES = ['sitting', 'risen', 'passed_over', 'lunch'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export interface DisplayBoardRow {
  /** The hall as printed without the "Court"/"Hall"/"No." words: `3`, `12A`. */
  hallNo: string;
  /** The item now being heard (`14`, `14A`); null when the hall shows none. */
  itemNow: string | null;
  status: BoardStatus;
  /** Items the board reports as passed over (heard later or dropped for the day). */
  passedOver: string[];
}

export interface ParsedDisplayBoard {
  /** `ok` with any row, `empty` for a readable board with no halls, `failed` when nothing is readable. */
  status: 'ok' | 'empty' | 'failed';
  rows: DisplayBoardRow[];
}
