// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Kbd } from './kbd';

describe('Kbd', () => {
  it('renders a <kbd> with its children', () => {
    render(<Kbd>Esc</Kbd>);
    expect(screen.getByText('Esc').tagName).toBe('KBD');
  });

  it('formats hotkeys for the platform', () => {
    render(
      <>
        <Kbd hotkey="mod+k" mac />
        <Kbd hotkey="mod+k" mac={false} />
      </>,
    );
    expect(screen.getByText('⌘K')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
  });

  it('uses the detected platform by default (jsdom is not a Mac)', () => {
    render(<Kbd hotkey="mod+k" />);
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
  });

  it('translates the chord joiner through labels', () => {
    render(<Kbd hotkey="g then t" mac={false} labels={{ then: 'ನಂತರ' }} />);
    expect(screen.getByText('G ನಂತರ T')).toBeInTheDocument();
  });
});
