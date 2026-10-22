// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { AdapterLevelBadge } from '../adapter-level-badge.tsx';

afterEach(cleanup);

describe('AdapterLevelBadge (#399)', () => {
  it.each([
    ['A0', 'Known court. Share a list or order and we will read it with your confirmation.'],
    ['A1', 'Document-assisted. We read lists and orders you share and match them to your matters.'],
  ] as const)('%s shows its code and the capability sentence', (level, sentence) => {
    const { container } = renderWithIntl(<AdapterLevelBadge level={level} withDescription />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.textContent).toContain(level);
    expect(badge?.textContent).toContain(`Adapter level ${level}`);
    expect(badge?.getAttribute('title')).toBe(sentence);
    expect(container.querySelector('[data-slot="adapter-level-description"]')?.textContent).toBe(
      sentence,
    );
  });

  it('keeps the sentence for screen readers without the visible description', () => {
    const { container } = renderWithIntl(<AdapterLevelBadge level="A0" />);
    expect(container.querySelector('[data-slot="adapter-level-description"]')).toBeNull();
    expect(container.textContent).toContain('Known court.');
  });

  it.each(['A2', 'A3'] as const)('does not show %s until it exists', (level) => {
    const { container } = renderWithIntl(<AdapterLevelBadge level={level} />);
    expect(container.innerHTML).toBe('');
  });
});
