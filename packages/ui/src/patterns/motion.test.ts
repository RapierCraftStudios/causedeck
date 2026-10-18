// Motion audit across the patterns (#145): card collapse 200 ms --ease-standard, chip popover 150 ms
// and undo toast 200 ms all come from the motion tokens, and all are instant under reduced motion.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { menuMotion } from '../lib/overlay';
import { motion } from '../../tokens/tokens';
import {
  CHECK_TRANSITION,
  COLLAPSE_TRANSITION,
  CONFIRM_CHECK_MS,
  EASE_STANDARD,
  INSTANT_TRANSITION,
} from './proposal-card/proposal-card';
import { provenanceChipClasses } from './provenance-chip/provenance-chip';

const read = (...parts: string[]) =>
  readFileSync(path.join(import.meta.dirname, '..', '..', ...parts), 'utf8');

const motionCss = read('tokens', 'motion.css');
const reducedCss = motionCss.slice(motionCss.indexOf('@media (prefers-reduced-motion: reduce)'));
const token = (css: string, name: string) =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe('pattern motion follows the tokens', () => {
  it('reads the token values from motion.css', () => {
    expect(token(motionCss, 'dur-fast')).toBe('150ms');
    expect(token(motionCss, 'dur-base')).toBe('200ms');
    expect(token(motionCss, 'ease-standard')).toBe(motion.easing.standard);
  });

  it('collapses a confirmed card over 200 ms --ease-standard on the token spring', () => {
    expect(CONFIRM_CHECK_MS).toBe(motion.duration.base);
    expect(EASE_STANDARD).toEqual([...motion.easingPoints.standard]);
    expect(motion.easing.standard).toBe(`cubic-bezier(${EASE_STANDARD.join(', ')})`);
    expect(COLLAPSE_TRANSITION).toMatchObject({
      type: motion.spring.type,
      stiffness: motion.spring.stiffness,
      damping: motion.spring.damping,
      opacity: { duration: motion.duration.base / 1000, ease: EASE_STANDARD },
    });
    expect(CHECK_TRANSITION).toEqual({
      duration: motion.duration.base / 1000,
      ease: EASE_STANDARD,
    });
  });

  it('opens the chip popover over --dur-fast (150 ms)', () => {
    expect(provenanceChipClasses).toContain('duration-(--dur-fast)');
    // The chip's popover is PopoverContent, whose open motion is `menuMotion`: fade + 4 px rise.
    expect(menuMotion).toContain('data-[state=open]:duration-(--dur-fast)');
    expect(menuMotion).toContain('data-[side=top]:slide-in-from-bottom-1');
  });

  it('slides the undo toast over --dur-base (200 ms)', () => {
    const sonner = read('src', 'components', 'sonner', 'sonner.css');
    expect(sonner).toMatch(/transition-duration: var\(--dur-base\)/);
    expect(sonner).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\{\s*transition: none/);
  });

  it('makes every duration instant under prefers-reduced-motion', () => {
    for (const name of [
      'dur-instant',
      'dur-exit',
      'dur-fast',
      'dur-base',
      'dur-slow',
      'dur-page',
    ]) {
      expect(token(reducedCss, name), name).toBe('0.01ms');
    }
    expect(token(reducedCss, 'motion-transform')).toBe('none');
    expect(reducedCss).toMatch(/transition-duration:\s*0\.01ms !important/);
    expect(reducedCss).toMatch(/animation-duration:\s*0\.01ms !important/);
    // The card's motion transitions are replaced outright (useReducedMotion in proposal-card).
    expect(INSTANT_TRANSITION).toEqual({ duration: 0 });
  });
});
