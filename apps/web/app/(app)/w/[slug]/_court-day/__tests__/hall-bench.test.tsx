// The hall bench line is a bench fact behind `bench_facts` (D-050): off shows no bench names, on
// shows them in their own line, apart from the item count.
import { cleanup, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeGetTranslations } from '../../../../../../__tests__/helpers/intl.ts';
import { HallBench } from '../hall-bench.tsx';

vi.mock('next-intl/server', () => ({ getTranslations: fakeGetTranslations('en') }));
vi.mock('../court-is-at-marker.tsx', () => ({ CourtIsAtMarker: () => null }));
vi.mock('../clash-card.tsx', () => ({ ClashCard: () => null }));
vi.mock('../item-card.tsx', () => ({
  ItemCard: () => null,
  changeOf: () => null,
  ordinalOf: () => null,
}));

const { HallColumn } = await import('../hall-column.tsx');

const hall = {
  hallId: 'h1',
  hallNo: '3',
  marker: null,
  lists: [{ items: [{ listingId: 'l1', itemNo: '1', bench: ['Justice Test One'] }] }],
} as never;

const props = (showBench: boolean) => ({
  hall,
  forum: 'High Court',
  slug: 'demo',
  workspaceId: 'ws-1',
  listDate: '2030-01-01',
  canWrite: false,
  clashes: [],
  hallNos: new Map<string, string>(),
  diffs: [],
  selected: true,
  tabStopListingId: null,
  showBench,
});

/** Every element in a React tree (props.children and props.detail included). */
function walk(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => walk(n as ReactNode, out));
  else if (node !== null && typeof node === 'object' && 'props' in node) {
    out.push(node);
    const p = node.props as { children?: ReactNode; detail?: ReactNode };
    walk(p.children, out);
    walk(p.detail, out);
  }
  return out;
}

afterEach(cleanup);

describe('hall bench (D-050, bench_facts)', () => {
  it('HallBench renders the bench on its own line, and nothing for an empty bench', async () => {
    const { container } = render(await HallBench({ names: ['Justice Test One'] }));
    expect(container.querySelector('[data-hall-bench]')?.textContent).toBe(
      'Before Justice Test One',
    );
    expect(await HallBench({ names: [] })).toBeNull();
  });

  it('the hall header carries the bench line only when showBench is true', async () => {
    const on = walk((await HallColumn(props(true))) as ReactNode);
    expect(on.some((el) => el.type === HallBench)).toBe(true);
    const off = walk((await HallColumn(props(false))) as ReactNode);
    expect(off.some((el) => el.type === HallBench)).toBe(false);
  });
});
