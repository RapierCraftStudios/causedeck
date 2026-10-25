// @vitest-environment jsdom
// Deferred `Add forum` (#427): the courts index renders a static `Add forum` button and loads the
// dialog chunk at idle or on interaction, so the dialog stays out of the route's initial JS. A
// click before the chunk arrives still opens the dialog; once loaded, the Radix trigger renders.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@causedeck/ui/sonner', () => ({ toast: vi.fn() }));

const { catalogs } = await import('../../../__tests__/helpers/intl.ts');
const { renderWithIntl, stubResizeObserver } = await import('../../shell/__tests__/helpers.tsx');
const { AddForum } = await import('../add-forum.tsx');

const en = catalogs.en.courts.addForum;
const props = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  takenCodes: [],
  action: vi.fn(),
};

beforeEach(() => {
  stubResizeObserver();
});

afterEach(cleanup);

describe('AddForum (#427)', () => {
  it('renders a static button first; a click before the dialog loads opens it', async () => {
    renderWithIntl(<AddForum {...props} />);
    const trigger = screen.getByRole('button', { name: en.trigger });
    expect(trigger.getAttribute('aria-haspopup')).toBeNull();
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: en.title })).toBeTruthy();
  });

  it('renders the dialog trigger once the chunk has loaded', async () => {
    renderWithIntl(<AddForum {...props} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: en.trigger }).getAttribute('aria-haspopup')).toBe(
        'dialog',
      );
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.trigger }));
    expect(await screen.findByRole('dialog', { name: en.title })).toBeTruthy();
  });
});
