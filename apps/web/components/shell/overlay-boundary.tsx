'use client';

import { Component, type ReactNode } from 'react';

/**
 * Keeps a failed overlay chunk out of the route error boundary. The shell's floating overlays
 * (camera, voice, paste text, install banner) are lazy chunks that load after first paint; losing
 * the connection before one arrives throws a ChunkLoadError, and without this the whole page
 * (a half-filled form included) is replaced by "Something went wrong". An overlay that did not
 * load simply is not there; the page keeps working.
 */
export class OverlayBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
