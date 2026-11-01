// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverlayBoundary } from '../overlay-boundary.tsx';

describe('OverlayBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders its children', () => {
    render(
      <OverlayBoundary>
        <p>overlay</p>
      </OverlayBoundary>,
    );
    expect(screen.getByText('overlay')).toBeTruthy();
  });

  it('drops a lazy overlay whose chunk fails to load and keeps the siblings', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = lazy(() => Promise.reject(new Error('ChunkLoadError')));
    render(
      <div>
        <p>page</p>
        <OverlayBoundary>
          <Suspense fallback={null}>
            <Broken />
          </Suspense>
        </OverlayBoundary>
      </div>,
    );
    await vi.waitFor(() => {
      expect(screen.getByText('page')).toBeTruthy();
    });
  });
});
