/** Design system: tokens, shadcn components, patterns, Storybook. */
export const packageName: string = '@causedeck/ui';

export { cn } from './lib/cn';
export {
  COLOR_TOKENS,
  color,
  motion,
  tokens,
  zIndex,
  type ColorToken,
  type ZIndexToken,
} from '../tokens/tokens';

export * from './components/button';
export * from './components/kbd';
export * from './components/spinner';
export * from './hooks';
export {
  fadeUp,
  getMotionPreset,
  listLayout,
  listSpring,
  motionPresets,
  reducedMotionPreset,
  scaleIn,
  sheet,
  withReducedMotion,
  type MotionPreset,
  type MotionPresetName,
} from './lib/motion';
