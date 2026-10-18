// Motion presets for the `motion` library, built from the #7 motion tokens (tokens/tokens.ts).
// Spread a preset onto a motion element: <motion.div {...getMotionPreset('fadeUp', reduced)} />.
// Under reduced motion every preset collapses: no transform or opacity animation, duration 0.
import type { Transition, Variants } from 'motion/react';

import { motion as tokens } from '../../tokens/tokens';

const seconds = (ms: number): number => ms / 1000;

const ease = {
  standard: [...tokens.easingPoints.standard] as [number, number, number, number],
  emphasized: [...tokens.easingPoints.emphasized] as [number, number, number, number],
  enter: [...tokens.easingPoints.enter] as [number, number, number, number],
  exit: [...tokens.easingPoints.exit] as [number, number, number, number],
};

/** List reordering spring `{ stiffness: 420, damping: 34 }` from the tokens. */
export const listSpring: Transition = {
  type: tokens.spring.type,
  stiffness: tokens.spring.stiffness,
  damping: tokens.spring.damping,
  mass: tokens.spring.mass,
};

export interface MotionPreset {
  initial: 'hidden';
  animate: 'visible';
  exit: 'exit';
  variants: Variants;
  transition?: Transition;
  /** Animate layout changes (list reordering). */
  layout?: boolean;
}

const enter = (duration: number, curve: keyof typeof ease = 'enter'): Transition => ({
  duration: seconds(duration),
  ease: ease[curve],
});
const leave = (duration: number = tokens.duration.fast): Transition => ({
  duration: seconds(duration),
  ease: ease.exit,
});

/** Content appearing: fade in while rising 4 px. */
export const fadeUp: MotionPreset = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: {
    hidden: { opacity: 0, y: 4 },
    visible: { opacity: 1, y: 0, transition: enter(tokens.duration.base) },
    exit: { opacity: 0, y: 4, transition: leave() },
  },
};

/** Popovers and dialogs: fade in from 98 % scale. */
export const scaleIn: MotionPreset = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: {
    hidden: { opacity: 0, scale: 0.98 },
    visible: { opacity: 1, scale: 1, transition: enter(tokens.duration.base, 'standard') },
    exit: { opacity: 0, scale: 0.98, transition: leave() },
  },
};

/** Side sheets: slide in from the inline end edge. */
export const sheet: MotionPreset = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  variants: {
    hidden: { x: '100%' },
    visible: { x: 0, transition: enter(tokens.duration.slow, 'emphasized') },
    exit: { x: '100%', transition: leave(tokens.duration.base) },
  },
};

/** List items: fade in and reorder with the token spring. */
export const listLayout: MotionPreset = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  layout: true,
  transition: listSpring,
  variants: {
    hidden: { opacity: 0, y: 4 },
    visible: { opacity: 1, y: 0, transition: listSpring },
    exit: { opacity: 0, transition: leave() },
  },
};

export const motionPresets = { fadeUp, scaleIn, sheet, listLayout } as const;

export type MotionPresetName = keyof typeof motionPresets;

/** Instant state changes: every variant is empty and nothing animates. */
export const reducedMotionPreset: MotionPreset = {
  initial: 'hidden',
  animate: 'visible',
  exit: 'exit',
  layout: false,
  transition: { duration: 0 },
  variants: { hidden: {}, visible: {}, exit: {} },
};

/** Collapse a preset when the user prefers reduced motion. */
export function withReducedMotion(preset: MotionPreset, reduced: boolean): MotionPreset {
  return reduced ? reducedMotionPreset : preset;
}

/** Look up a preset by name, collapsed under reduced motion (use with `useReducedMotion()`). */
export function getMotionPreset(name: MotionPresetName, reduced: boolean): MotionPreset {
  return withReducedMotion(motionPresets[name], reduced);
}
