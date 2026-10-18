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

export * from './components/alert';
export * from './components/avatar';
export * from './components/badge';
export * from './components/button';
export * from './components/card';
export * from './components/chart';
export * from './components/empty-state';
export * from './components/icon-button';
export * from './components/kbd';
export * from './components/progress';
export * from './components/resizable';
export * from './components/scroll-area';
export * from './components/separator';
export * from './components/skeleton';
export * from './components/sonner';
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
