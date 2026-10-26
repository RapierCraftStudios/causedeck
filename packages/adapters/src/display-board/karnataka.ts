// Karnataka HC display board (#493): `Court Hall No. | Sl. No. Now Hearing | Remarks`; the remarks
// carry the state and any "Passed over 12, 14" cue.
import { readDisplayBoard } from './reader.ts';
import type { ParsedDisplayBoard } from './types.ts';

export function parseKarnatakaDisplayBoard(html: string): ParsedDisplayBoard {
  return readDisplayBoard(html, {
    hall: /hall/i,
    item: /sl\.?\s*no|hearing/i,
    status: /remark|status/i,
  });
}
