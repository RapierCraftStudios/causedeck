import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('joins conditional class names', () => {
    expect(cn('px-2', undefined, null, ['text-ink', { 'font-serif': true, hidden: false }])).toBe(
      'px-2 text-ink font-serif',
    );
  });

  it('lets the last conflicting utility win, including preset scales', () => {
    expect(cn('px-2 px-4')).toBe('px-4');
    expect(cn('shadow-1', 'shadow-3')).toBe('shadow-3');
    expect(cn('text-sm', 'text-display')).toBe('text-display');
  });

  it('keeps colour and size utilities that share the text- prefix', () => {
    expect(cn('text-ink', 'text-md')).toBe('text-ink text-md');
  });
});
