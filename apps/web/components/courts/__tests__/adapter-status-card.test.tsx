// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl, stubResizeObserver } from '../../shell/__tests__/helpers.tsx';
import { AdapterStatusCard } from '../adapter-status-card.tsx';

import { adapterStatus } from './fixtures.ts';

beforeEach(() => {
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const field = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-adapter-field="${name}"] dd`);

describe('AdapterStatusCard (#400)', () => {
  it('shows id, version, level, verification, health and the last parse', () => {
    const { container } = renderWithIntl(<AdapterStatusCard status={adapterStatus()} />);
    expect(field(container, 'id')?.textContent).toBe('in.tn.madras-hc.principal');
    expect(field(container, 'version')?.textContent).toBe('1.2.0');
    expect(field(container, 'level')?.querySelector('[data-adapter-level="A1"]')).not.toBeNull();
    expect(field(container, 'verified')?.querySelector('time')?.textContent).toMatch(/2026/);
    const health = container.querySelector('[data-adapter-health="degraded"]');
    expect(health?.textContent).toBe('Some lists not read');
    expect(health?.querySelector('[data-slot="status-dot"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    const last = field(container, 'last-parse')?.textContent ?? '';
    expect(last).toContain('120 rows read, 14 matched to matters');
    expect(last).toContain('Unreadable halls: 7, 12A');
  });

  it('says when the version is not yet verified and nothing ran', () => {
    const { container } = renderWithIntl(
      <AdapterStatusCard
        status={adapterStatus({
          activeVersion: null,
          lastVerifiedAt: null,
          health: null,
          lastParse: null,
        })}
      />,
    );
    expect(field(container, 'verified')?.textContent).toBe('Not yet verified with real lists');
    expect(field(container, 'version')?.textContent).toBe('No active version');
    expect(container.querySelector('[data-adapter-health="none"]')?.textContent).toBe(
      'No runs yet',
    );
    expect(field(container, 'last-parse')?.textContent).toBe('No lists shared yet');
  });

  it('explains the levels in a keyboard-reachable popover without offering A2/A3', () => {
    renderWithIntl(<AdapterStatusCard status={adapterStatus()} />);
    const trigger = screen.getByRole('button', { name: 'What the levels mean' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);
    const popover = document.querySelector('[data-adapter-levels]');
    expect(popover).not.toBeNull();
    const help = [...(popover?.querySelectorAll('[data-adapter-level-help]') ?? [])];
    expect(help.map((item) => item.getAttribute('data-adapter-level-help'))).toEqual(['A0', 'A1']);
    expect(popover?.textContent).toContain('Higher levels');
    expect(popover?.textContent).not.toMatch(/A2|A3/);
  });
});
