import { describe, expect, it } from 'vitest';

const { loadShellOverlays } = await import('../use-shell-overlays.ts');

// Node environment: no `document`, as when a load started under jsdom settles after teardown (#323).
describe('loadShellOverlays', () => {
  it('loadShellOverlays settles without a DOM (load finishing after jsdom teardown)', async () => {
    expect(typeof document).toBe('undefined');
    const overlays = await loadShellOverlays();
    expect(overlays).toHaveProperty('Popover');
    expect(overlays).toHaveProperty('NavActiveIndicator');
  });
});
