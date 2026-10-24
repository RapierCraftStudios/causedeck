// Madras HC display board (#493): `Court | Item No. | Status | Passed Over`.
import { readDisplayBoard } from './reader.ts';
import type { ParsedDisplayBoard } from './types.ts';

export function parseMadrasDisplayBoard(html: string): ParsedDisplayBoard {
  return readDisplayBoard(html, {
    hall: /^court\b/i,
    item: /item/i,
    status: /status/i,
    passedOver: /pass(ed)?[\s-]*over/i,
  });
}
