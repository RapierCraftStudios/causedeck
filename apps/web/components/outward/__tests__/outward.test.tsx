// @vitest-environment jsdom
// Outward drafts UI (#736): the banner, keyboard shortcuts, hand-offs opened by the lawyer with
// noopener and no server transport, and the denied and offline states. Fictional text only.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs } from '../../../__tests__/helpers/intl.ts';
import { DraftEditor, type DraftView } from '../draft-editor.tsx';
import { OutwardStates } from '../draft-list.tsx';

const t = catalogs.en.outward;
const draft: DraftView = {
  id: '00000000-0000-4000-8000-000000000001',
  matterId: '00000000-0000-4000-8000-000000000002',
  matterTitle: 'Meera Rao v. Example Traders (fictional)',
  audience: 'client',
  language: 'en',
  body: 'Next date: 12 Dec 2026.',
  systemBody: 'Next date: 12 Dec 2026.',
  facts: [{ kind: 'next_date', text: '12 Dec 2026', confirmed: false, source: 'hearing' }],
  memoryCitations: [],
};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={catalogs.en}>
    {node}
  </NextIntlClientProvider>
);
const editor = (extra: Partial<React.ComponentProps<typeof DraftEditor>> = {}) => {
  const props = {
    draft,
    offline: false,
    readOnly: false,
    onSave: vi.fn(() => Promise.resolve({ ok: true, warnings: [] })),
    onShared: vi.fn(() => Promise.resolve(true)),
    onLanguageChange: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  };
  render(wrap(<DraftEditor {...props} />));
  return props;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('outward drafts UI', () => {
  it('shows the no-send banner and flags a fact to be confirmed', () => {
    editor();
    expect(screen.getByText(t.banner)).toBeTruthy();
    expect(screen.getByText(t.editor.factToConfirm)).toBeTruthy();
  });

  it('cites the memory a draft used on the facts rail (R4)', () => {
    editor({
      draft: {
        ...draft,
        memoryCitations: [
          { key: 'M2.client_update_tone', date: '2026-08-12' },
          { key: 'M6.client_language', date: '2026-09-02' },
        ],
      },
    });
    expect(screen.getByText(catalogs.en.memoryCitations.draftTitle)).toBeTruthy();
    expect(
      screen.getByLabelText(
        catalogs.en.memoryCitations.chipLabel.replace(
          '{reason}',
          catalogs.en.memoryCitations.draftTone,
        ),
      ),
    ).toBeTruthy();
    expect(screen.getByText('Saved 2026-09-02')).toBeTruthy();
  });

  it('shows no memory block when the draft used none', () => {
    editor();
    expect(screen.queryByText(catalogs.en.memoryCitations.draftTitle)).toBeNull();
  });

  it('copies with Ctrl+Enter, cycles the language with l, shows changes with d, closes with Esc', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const props = editor();
    const region = screen.getByRole('region');
    fireEvent.keyDown(region, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(draft.body);
    });
    await waitFor(() => {
      expect(screen.getAllByText(t.share.copied).length).toBeGreaterThan(0);
    });
    fireEvent.keyDown(region, { key: 'l' });
    expect(props.onLanguageChange).toHaveBeenCalledWith('ta');
    fireEvent.keyDown(region, { key: 'd' });
    expect(screen.getByText(t.diff.unchanged)).toBeTruthy();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('opens WhatsApp and email with noopener and only records the share afterwards', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const props = editor();
    fireEvent.click(screen.getByRole('button', { name: t.share.whatsapp }));
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/wa\.me\/\?text=/),
      '_blank',
      'noopener,noreferrer',
    );
    expect(props.onShared).toHaveBeenCalledWith('whatsapp_link');
    fireEvent.click(screen.getByRole('button', { name: t.share.email }));
    expect(open).toHaveBeenLastCalledWith(
      expect.stringMatching(/^mailto:\?subject=/),
      '_blank',
      'noopener,noreferrer',
    );
    expect(props.onShared).toHaveBeenCalledWith('mailto');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('disables sharing offline and view-only, and renders the denied and empty states', () => {
    editor({ offline: true });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t.share.whatsapp }).disabled).toBe(
      true,
    );
    cleanup();
    render(wrap(<OutwardStates state="denied" />));
    expect(screen.getByText(t.denied)).toBeTruthy();
    cleanup();
    render(wrap(<OutwardStates state="empty" />));
    expect(screen.getByText(t.empty.title)).toBeTruthy();
  });
});
