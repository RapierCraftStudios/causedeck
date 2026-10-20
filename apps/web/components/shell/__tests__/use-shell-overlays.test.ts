import { describe, expect, it, vi } from 'vitest';

// Only the loader is under test: stand in for React and the overlay chunk, so the test needs no DOM
// and no component tree (the real chunk is covered by the shell component tests).
vi.mock('react', () => ({ useEffect: vi.fn(), useSyncExternalStore: vi.fn() }));
vi.mock('../shell-overlays.tsx', () => ({ Popover: 'Popover', NavActiveIndicator: 'Indicator' }));

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
