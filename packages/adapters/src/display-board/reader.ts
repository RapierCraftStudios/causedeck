// The shared display-board reader (#493). Both boards are assumed to print one table row per hall
// (the shape is recorded in the golden fixtures; ADR 0019 style): a header row naming the hall and
// item columns, then `hall | item | status [| passed over]`. The visible text comes from the HTML
// layout reader, which joins the cells of a row with a tab. Pure and total: no clock, no I/O, never
// throws. A row whose hall cannot be read is dropped; a board with a header and no rows is `empty`.
import { layoutFromHtml } from '../layout/html.ts';

import type { BoardStatus, DisplayBoardRow, ParsedDisplayBoard } from './types.ts';

export interface BoardColumns {
  hall: RegExp;
  item: RegExp;
  status: RegExp;
  passedOver?: RegExp;
}

const HALL_WORDS = /\b(court|hall|room|no\.?)\b/gi;
const ITEM = /\b\d{1,4}[A-Z]?\b/g;

export function normaliseHall(raw: string): string | null {
  const hall = raw.replace(HALL_WORDS, ' ').replace(/[.:]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^\d{1,3}[A-Za-z]?$/.test(hall) ? hall.toUpperCase() : null;
}

export function normaliseStatus(raw: string): BoardStatus {
  const text = raw.toLowerCase();
  if (/ris(en|e)|adjourn|not sitting/.test(text)) return 'risen';
  if (/lunch|recess/.test(text)) return 'lunch';
  if (/pass(ed)?[\s-]*over/.test(text)) return 'passed_over';
  return 'sitting';
}

/** The item numbers after a "passed over" cue (or the whole cell of a passed-over column). */
function passedItems(text: string, wholeCell: boolean): string[] {
  const at = text.search(/pass(ed)?[\s-]*over/i);
  const tail = wholeCell ? text : at < 0 ? '' : text.slice(at);
  return [...new Set((tail.toUpperCase().match(ITEM) ?? []).map((item) => item))];
}

function itemOf(raw: string): string | null {
  const match = raw.toUpperCase().match(ITEM);
  return match?.[0] ?? null;
}

export function readDisplayBoard(html: string, columns: BoardColumns): ParsedDisplayBoard {
  const lines = (layoutFromHtml(html).pages[0]?.text ?? '').split('\n');
  let index: { hall: number; item: number; status: number; passed: number } | null = null;
  const rows: DisplayBoardRow[] = [];
  for (const line of lines) {
    const cells = line.split('\t').map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (index === null) {
      const hall = cells.findIndex((cell) => columns.hall.test(cell));
      const item = cells.findIndex((cell) => columns.item.test(cell));
      if (hall >= 0 && item >= 0 && hall !== item) {
        index = {
          hall,
          item,
          status: cells.findIndex((cell) => columns.status.test(cell)),
          passed:
            columns.passedOver === undefined
              ? -1
              : cells.findIndex((cell) => columns.passedOver?.test(cell) === true),
        };
      }
      continue;
    }
    const hallNo = normaliseHall(cells[index.hall] ?? '');
    if (hallNo === null) continue;
    const statusText = index.status >= 0 ? (cells[index.status] ?? '') : '';
    const passedCell = index.passed >= 0 ? (cells[index.passed] ?? '') : '';
    rows.push({
      hallNo,
      itemNow: itemOf(cells[index.item] ?? ''),
      status: normaliseStatus(statusText),
      passedOver: [
        ...new Set([...passedItems(statusText, false), ...passedItems(passedCell, true)]),
      ],
    });
  }
  if (index === null) return { status: 'failed', rows: [] };
  return { status: rows.length === 0 ? 'empty' : 'ok', rows };
}
