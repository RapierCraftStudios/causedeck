import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseKarnatakaDisplayBoard, parseMadrasDisplayBoard } from './index.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('display-board golden fixtures', () => {
  it('reads the Madras HC board', () => {
    expect(parseMadrasDisplayBoard(fixture('madras-board.html'))).toEqual({
      status: 'ok',
      rows: [
        { hallNo: '1', itemNow: '23', status: 'sitting', passedOver: ['7', '9'] },
        { hallNo: '12A', itemNow: '5', status: 'sitting', passedOver: [] },
        { hallNo: '4', itemNow: '41', status: 'risen', passedOver: [] },
        { hallNo: '7', itemNow: null, status: 'lunch', passedOver: [] },
      ],
    });
  });

  it('reads the Karnataka HC board', () => {
    expect(parseKarnatakaDisplayBoard(fixture('karnataka-board.html'))).toEqual({
      status: 'ok',
      rows: [
        { hallNo: '1', itemNow: '14', status: 'sitting', passedOver: [] },
        { hallNo: '2', itemNow: '3', status: 'passed_over', passedOver: ['12', '14'] },
        { hallNo: '9', itemNow: '30', status: 'risen', passedOver: [] },
        { hallNo: '11', itemNow: null, status: 'lunch', passedOver: [] },
      ],
    });
  });

  it('is total on unreadable input', () => {
    expect(parseMadrasDisplayBoard('<p>maintenance</p>')).toEqual({ status: 'failed', rows: [] });
    expect(
      parseKarnatakaDisplayBoard('<table><tr><th>Court Hall</th><th>Sl. No.</th></tr></table>'),
    ).toEqual({ status: 'empty', rows: [] });
  });
});
