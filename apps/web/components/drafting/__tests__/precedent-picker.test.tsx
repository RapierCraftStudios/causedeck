// @vitest-environment jsdom
import type { Block } from '@causedeck/validators/drafting';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import {
  PrecedentPanel,
  PrecedentPicker,
  precedentKindFor,
  type PrecedentPassage,
  type PrecedentSearch,
} from '../precedent-picker.tsx';

afterEach(cleanup);

const passage = (id: string, text: string): PrecedentPassage => ({
  passageId: id,
  text,
  kind: 'prayer',
  courtId: null,
  language: 'en',
  sourceDraftVersionId: 'v1',
  anchorId: 'b.1',
  score: 50,
  reasons: [{ code: 'kind', text: `Same kind ${id}` }],
});
const first = passage('p1', 'First passage text');
const second = passage('p2', 'Second passage text');

describe('PrecedentPicker', () => {
  it('lists passages in the given order with the reason each is suggested', () => {
    renderWithIntl(
      <PrecedentPicker
        passages={[first, second]}
        status="ready"
        selectedBlock="b.0"
        onInsert={vi.fn()}
      />,
    );
    const items = screen
      .getAllByRole('listitem')
      .filter((li) => li.dataset['slot'] === 'precedent-passage');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('First passage text'),
      expect.stringContaining('Second passage text'),
    ]);
    expect(screen.getByText('Same kind p1')).toBeTruthy();
    expect(screen.getByText('Same kind p2')).toBeTruthy();
  });

  it('inserts only on a click, once, with the chosen passage', () => {
    const onInsert = vi.fn();
    renderWithIntl(
      <PrecedentPicker
        passages={[first, second]}
        status="ready"
        selectedBlock="b.0"
        onInsert={onInsert}
      />,
    );
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert' })[1] as HTMLElement);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(second);
  });

  it('turns insert off when disabled', () => {
    renderWithIntl(
      <PrecedentPicker
        passages={[first]}
        status="ready"
        selectedBlock="b.0"
        disabled
        onInsert={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Insert' })).toHaveProperty('disabled', true);
  });

  it.each([
    ['empty', /Passages you approve will appear here/],
    ['loading', /Finding your passages/],
    ['error', /could not be loaded/],
    ['offline', /Offline/],
    ['denied', /Your role cannot read/],
  ] as const)('renders the %s state', (state, text) => {
    renderWithIntl(
      <PrecedentPicker
        passages={[]}
        status={state === 'empty' ? 'ready' : state}
        selectedBlock="b.0"
        onInsert={vi.fn()}
      />,
    );
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('asks for a block when none is selected', () => {
    renderWithIntl(<PrecedentPicker passages={[first]} status="ready" onInsert={vi.fn()} />);
    expect(screen.getByText(/Select a narrative block/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Insert' })).toBeNull();
  });
});

describe('PrecedentPanel', () => {
  const blocks: Block[] = [
    { type: 'paragraph', id: 'intro', text: 'Hello' },
    { type: 'narrative', id: 'prayer-1', prompt: 'Write the prayer', maxChars: 500 },
  ];
  const base = { workspaceId: 'w1', blocks, language: 'en', courtId: null } as const;

  it('searches with the narrative prompt, shows the ranked result and hands the pick up', async () => {
    const search = vi
      .fn<PrecedentSearch>()
      .mockResolvedValue({ ok: true, data: { passages: [first, second] } });
    const onInsert = vi.fn();
    renderWithIntl(
      <PrecedentPanel
        {...base}
        selectedBlock="prayer-1"
        online
        search={search}
        onInsert={onInsert}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Insert' })).toHaveLength(2);
    });
    expect(search).toHaveBeenCalledWith({
      workspaceId: 'w1',
      query: 'Write the prayer',
      courtId: null,
      kind: 'prayer',
      language: 'en',
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert' })[0] as HTMLElement);
    expect(onInsert).toHaveBeenCalledWith('prayer-1', first);
  });

  it('shows permission denied for a FORBIDDEN result', async () => {
    const search = vi
      .fn<PrecedentSearch>()
      .mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: '' } } as never);
    renderWithIntl(
      <PrecedentPanel
        {...base}
        selectedBlock="prayer-1"
        online
        search={search}
        onInsert={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Your role cannot read/)).toBeTruthy();
    });
  });

  it('does not search offline or for a block that is not narrative', () => {
    const search = vi.fn<PrecedentSearch>();
    renderWithIntl(
      <PrecedentPanel
        {...base}
        selectedBlock="prayer-1"
        online={false}
        search={search}
        onInsert={vi.fn()}
      />,
    );
    expect(screen.getByText(/Offline/)).toBeTruthy();
    cleanup();
    renderWithIntl(
      <PrecedentPanel {...base} selectedBlock="intro" online search={search} onInsert={vi.fn()} />,
    );
    expect(screen.getByText(/Select a narrative block/)).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });
});

describe('precedentKindFor', () => {
  it('asks for prayers on a prayer block and is open otherwise', () => {
    expect(precedentKindFor('prayer-1')).toBe('prayer');
    expect(precedentKindFor('b.3')).toBeNull();
  });
});
