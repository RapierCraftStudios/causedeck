import { describe, expect, it } from 'vitest';

import { motion } from '../../tokens/tokens';
import {
  fadeUp,
  getMotionPreset,
  listLayout,
  listSpring,
  motionPresets,
  reducedMotionPreset,
  scaleIn,
  sheet,
} from './motion';

const ANIMATED = ['x', 'y', 'scale', 'opacity', 'rotate'];

describe('motion presets', () => {
  it('take durations and easings from the tokens', () => {
    expect(fadeUp.variants['visible']).toMatchObject({
      transition: { duration: motion.duration.base / 1000, ease: [...motion.easingPoints.enter] },
    });
    expect(scaleIn.variants['visible']).toMatchObject({
      transition: {
        duration: motion.duration.base / 1000,
        ease: [...motion.easingPoints.standard],
      },
    });
    expect(sheet.variants['visible']).toMatchObject({
      transition: {
        duration: motion.duration.slow / 1000,
        ease: [...motion.easingPoints.emphasized],
      },
    });
    expect(fadeUp.variants['exit']).toMatchObject({
      transition: { duration: motion.duration.fast / 1000, ease: [...motion.easingPoints.exit] },
    });
  });

  it('reorders lists with the token spring { stiffness: 420, damping: 34 }', () => {
    expect(listSpring).toMatchObject({ type: 'spring', stiffness: 420, damping: 34 });
    expect(listLayout.layout).toBe(true);
    expect(listLayout.transition).toBe(listSpring);
  });

  it.each(Object.keys(motionPresets) as (keyof typeof motionPresets)[])(
    '%s collapses under reduced motion: no transform or opacity, instant',
    (name) => {
      const preset = getMotionPreset(name, true);
      expect(preset).toBe(reducedMotionPreset);
      for (const variant of Object.values(preset.variants)) {
        expect(Object.keys(variant as object).filter((k) => ANIMATED.includes(k))).toEqual([]);
      }
      expect(preset.transition).toEqual({ duration: 0 });
      expect(preset.layout).toBe(false);
      expect(getMotionPreset(name, false)).toBe(motionPresets[name]);
    },
  );
});
