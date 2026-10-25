import { describe, expect, it } from 'vitest';

import { diffDraft } from '../diff.ts';

const joined = (parts: ReturnType<typeof diffDraft>, type: string) =>
  parts
    .filter((p) => p.op === type)
    .map((p) => p.text)
    .join('');

describe('diffDraft', () => {
  it('reports no change for equal text', () => {
    const parts = diffDraft('The next date is 12 December.', 'The next date is 12 December.');
    expect(parts.every((p) => p.op === 'equal')).toBe(true);
  });

  it('marks removed and added words', () => {
    const parts = diffDraft('The next date is Monday.', 'The next date is Tuesday.');
    expect(joined(parts, 'delete')).toContain('Monday');
    expect(joined(parts, 'insert')).toContain('Tuesday');
    expect(joined(parts, 'equal')).toContain('next date');
  });

  it('tokenises Tamil and Kannada words without splitting their combining marks', () => {
    const ta = diffDraft('அடுத்த தேதி திங்கள்', 'அடுத்த தேதி செவ்வாய்');
    expect(joined(ta, 'delete')).toContain('திங்கள்');
    expect(joined(ta, 'insert')).toContain('செவ்வாய்');
    const kn = diffDraft('ಮುಂದಿನ ದಿನಾಂಕ ಸೋಮವಾರ', 'ಮುಂದಿನ ದಿನಾಂಕ ಮಂಗಳವಾರ');
    expect(joined(kn, 'delete')).toContain('ಸೋಮವಾರ');
    expect(joined(kn, 'insert')).toContain('ಮಂಗಳವಾರ');
  });
});
