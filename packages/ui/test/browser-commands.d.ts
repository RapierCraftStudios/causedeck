// Custom Vitest browser commands registered in vitest.config.ts.
import '@vitest/browser/context';

declare module '@vitest/browser/context' {
  interface BrowserCommands {
    emulateReducedMotion: (reducedMotion: 'reduce' | 'no-preference') => Promise<void>;
  }
}
