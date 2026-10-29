// @vitest-environment jsdom
// On touch devices the help sheet's Shortcuts tab shows a gestures guide, not the key table (#94).
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockMatchMedia,
  renderWithIntl,
  stubResizeObserver,
} from '../../shell/__tests__/helpers.tsx';

vi.mock('../help-articles.tsx', () => ({ HelpArticles: () => null }));
vi.mock('../support-contact.tsx', () => ({ SupportContact: () => null }));

const { HelpSheet, GesturesGuide } = await import('../help-sheet.tsx');

beforeEach(() => {
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openShortcuts(media: Record<string, boolean>) {
  mockMatchMedia(media);
  renderWithIntl(
    <HelpSheet
      open
      onOpenChange={() => undefined}
      workspaceId="w1"
      role="owner"
      initialTab="shortcuts"
    />,
  );
}

describe('help sheet on touch', () => {
  it('replaces the shortcut table with the gestures guide', () => {
    openShortcuts({ '(pointer: coarse)': true });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('shows the labelled shortcut table with a fine pointer', () => {
    openShortcuts({ '(pointer: coarse)': false });
    expect(screen.getByRole('table').getAttribute('aria-label')).toBeTruthy();
  });

  it('renders the guide on its own', () => {
    mockMatchMedia();
    renderWithIntl(<GesturesGuide />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});
