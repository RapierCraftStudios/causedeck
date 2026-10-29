// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScopeChip } from './scope-chip';

describe('ScopeChip', () => {
  it.each([
    ['user', 'Only you'],
    ['workspace', 'Chamber'],
    ['matter', 'This matter'],
  ] as const)('says %s in text', (scope, label) => {
    render(<ScopeChip scope={scope} />);
    expect(screen.getByText(label)).toHaveAttribute('data-scope', scope);
  });

  it('takes translated labels', () => {
    render(<ScopeChip scope="user" labels={{ user: 'Sirf aap' }} />);
    expect(screen.getByText('Sirf aap')).toBeInTheDocument();
  });
});
