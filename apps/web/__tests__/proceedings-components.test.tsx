// @vitest-environment jsdom
// Proceedings tab components (#392, #40 part 4): the tree moves with the arrow keys (`role="tree"`,
// roving tabindex); the state menu offers only the legal transitions, needs number and year to
// number a proceeding, a reason to reopen a disposed one and takes an optional cure deadline for
// defects; `Esc` returns focus to the invoker. The proceeding form matches case types in any
// punctuation, keeps free text, and shows the duplicate prompt with `Merge`. The merge dialog
// explains why a sensitive matter cannot be merged and offers no Merge; a merge or split shows a
// toast whose Undo (10 seconds) calls the inverse with the returned payload. Offline, every
// mutation is off.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatterAnnouncer } from '../components/matters/matter-announcer.tsx';
import {
  MergeMatterDialog,
  SplitMatterDialog,
  type MovePreviewView,
} from '../components/matters/merge-split-dialogs.tsx';
import {
  caseTypeComboOptions,
  caseTypeMatches,
  createInput,
  ProceedingForm,
  type ProceedingDraft,
  type ProceedingFormActions,
} from '../components/matters/proceeding-form.tsx';
import { ProceedingTree } from '../components/matters/proceeding-tree.tsx';
import { StateTransitionMenu } from '../components/matters/state-transition-menu.tsx';
import { UNDO_WINDOW_MS } from '../components/matters/undo-toast.tsx';
import type { ForumOption, ProceedingRowView } from '../lib/matters/proceedings-view.ts';
import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';

import { catalogs } from './helpers/intl.ts';

const WS = 'ws-1';
const MATTER = 'm-1';
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(() => 't1'), error: vi.fn() }),
);

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/w/demo/matters/m-1/proceedings',
}));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));

const tab = catalogs.en.matters.workspace.proceedingsTab;

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <MatterAnnouncer>{ui}</MatterAnnouncer>
    </NextIntlClientProvider>,
  );

const announcer = () => document.querySelector('[data-matter-announcer]') as HTMLElement;
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

function row(id: string, overrides: Partial<ProceedingRowView> = {}): ProceedingRowView {
  return {
    id,
    depth: 1,
    kind: 'main',
    state: 'numbered',
    caseType: 'W.P.',
    caseNumber: { type: 'W.P.', number: '12345', year: 2026 },
    label: `W.P. ${id}`,
    unnumbered: false,
    forum: 'High Court of Madras, Chennai',
    forumId: 'f1',
    srNo: null,
    frNo: null,
    diaryNo: null,
    filingNo: null,
    cnr: null,
    stage: null,
    nextDate: null,
    links: [],
    transitions: [],
    children: [],
    ...overrides,
  };
}

const FORUMS: ForumOption[] = [
  {
    id: 'f1',
    name: 'High Court of Madras, Chennai',
    code: 'in.tn.madras-hc.principal.appellate',
    caseTypes: [
      { code: 'WP', label: 'WP', aliases: ['Writ Petition'] },
      { code: 'WA', label: 'WA', aliases: ['Writ Appeal'] },
    ],
  },
];

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

/** Open a Radix dropdown from its trigger with the keyboard. */
function openMenu(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  stubResizeObserver();
  mockMatchMedia({ '(hover: hover) and (pointer: fine)': true });
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProceedingTree keyboard (#392)', () => {
  const rows = [
    row('a', { children: [row('a1', { depth: 2 }), row('a2', { depth: 2 })] }),
    row('b'),
  ];

  it('moves with the arrow keys, Home and End, and expands and collapses', () => {
    withIntl(
      <ProceedingTree
        workspaceId={WS}
        slug="demo"
        matterId={MATTER}
        rows={rows}
        forums={FORUMS}
        canWrite={false}
      />,
    );
    const item = (id: string) => document.querySelector(`[data-treeitem="${id}"]`) as HTMLElement;
    expect(screen.getByRole('tree').getAttribute('aria-label')).toBe(tab.treeLabel);
    expect(item('a').tabIndex).toBe(0);
    expect(item('a1').tabIndex).toBe(-1);
    item('a').focus();
    fireEvent.keyDown(item('a'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('a1'));
    expect(item('a1').tabIndex).toBe(0);
    expect(item('a').tabIndex).toBe(-1);
    fireEvent.keyDown(item('a1'), { key: 'End' });
    expect(document.activeElement).toBe(item('b'));
    fireEvent.keyDown(item('b'), { key: 'Home' });
    expect(document.activeElement).toBe(item('a'));
    fireEvent.keyDown(item('a'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(item('a1'));
    fireEvent.keyDown(item('a1'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(item('a'));
    fireEvent.keyDown(item('a'), { key: 'ArrowLeft' });
    expect(item('a').getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-treeitem="a1"]')).toBeNull();
    fireEvent.keyDown(item('a'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('b'));
    fireEvent.keyDown(item('b'), { key: 'ArrowUp' });
    fireEvent.keyDown(item('a'), { key: 'ArrowRight' });
    expect(item('a').getAttribute('aria-expanded')).toBe('true');
  });

  it('expands and collapses children with a visible control too (#392 design critique)', () => {
    withIntl(
      <ProceedingTree
        workspaceId={WS}
        slug="demo"
        matterId={MATTER}
        rows={rows}
        forums={FORUMS}
        canWrite={false}
      />,
    );
    const toggle = screen.getByRole('button', {
      name: tab.collapse.replace('{label}', 'W.P. a'),
    });
    expect(document.querySelector('[data-toggle-children="b"]')).toBeNull();
    fireEvent.click(toggle);
    expect(document.querySelector('[data-treeitem="a"]')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(document.querySelector('[data-treeitem="a1"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: tab.expand.replace('{label}', 'W.P. a') }));
    expect(document.querySelector('[data-treeitem="a1"]')).not.toBeNull();
  });

  it('marks split selections, counts them, hides row actions and leaves split mode on Esc', () => {
    const noop = vi.fn();
    withIntl(
      <ProceedingTree
        workspaceId={WS}
        slug="demo"
        matterId={MATTER}
        rows={[row('a', { transitions: ['disposed'] }), row('b')]}
        forums={FORUMS}
        canWrite
        actions={{
          form: { create: noop, update: noop, link: noop, findDuplicates: noop },
          transition: noop,
          merge: { search: noop, preview: noop, merge: noop, undo: noop },
          split: { preview: noop, split: noop, undo: noop },
        }}
      />,
    );
    const item = (id: string) => document.querySelector(`[data-treeitem="${id}"]`) as HTMLElement;
    expect(item('a').getAttribute('aria-selected')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: tab.splitStart }));
    expect(document.querySelector('[data-row-actions]')).toBeNull();
    expect(item('a').getAttribute('aria-selected')).toBe('false');
    fireEvent.click(document.querySelector('[data-split-select="a"]') as HTMLElement);
    expect(item('a').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-proceeding-row="a"]')?.hasAttribute('data-selected')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Continue with 1 proceeding' })).toBeTruthy();
    item('a').focus();
    fireEvent.keyDown(item('a'), { key: 'Escape' });
    expect(document.querySelector('[data-split-select]')).toBeNull();
    expect(document.querySelector('[data-row-actions]')).not.toBeNull();
  });

  it('keeps one primary Add on an empty tree: the empty state’s', () => {
    const noop = vi.fn();
    withIntl(
      <ProceedingTree
        workspaceId={WS}
        slug="demo"
        matterId={MATTER}
        rows={[]}
        forums={FORUMS}
        canWrite
        actions={{
          form: { create: noop, update: noop, link: noop, findDuplicates: noop },
          transition: noop,
          merge: { search: noop, preview: noop, merge: noop, undo: noop },
          split: { preview: noop, split: noop, undo: noop },
        }}
      />,
    );
    expect(screen.getAllByRole('button', { name: tab.add })).toHaveLength(1);
    expect(document.querySelector('[data-add-proceeding]')).toBeNull();
    expect(document.querySelector('[data-empty-add]')).not.toBeNull();
  });

  it('turns every mutation off while offline', () => {
    setOnline(false);
    const noop = vi.fn();
    withIntl(
      <ProceedingTree
        workspaceId={WS}
        slug="demo"
        matterId={MATTER}
        rows={[row('a', { transitions: ['disposed'] })]}
        forums={FORUMS}
        canWrite
        actions={{
          form: { create: noop, update: noop, link: noop, findDuplicates: noop },
          transition: noop,
          merge: { search: noop, preview: noop, merge: noop, undo: noop },
          split: { preview: noop, split: noop, undo: noop },
        }}
      />,
    );
    for (const name of [tab.add, tab.mergeIn, tab.splitStart]) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled, name).toBe(true);
    }
    expect((document.querySelector('[data-transition-menu]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('StateTransitionMenu (#392)', () => {
  it('renders nothing without a legal transition', () => {
    withIntl(
      <StateTransitionMenu
        workspaceId={WS}
        proceedingId="p1"
        label="WP 1/2026"
        state="filed"
        transitions={[]}
        action={vi.fn()}
      />,
    );
    expect(document.querySelector('[data-transition-menu]')).toBeNull();
  });

  it('offers only the legal moves and needs number and year to number', async () => {
    const action = vi.fn(() => ok({}));
    withIntl(
      <StateTransitionMenu
        workspaceId={WS}
        proceedingId="p1"
        label="WP SR 4521"
        state="sr_fr"
        transitions={['defects', 'numbered']}
        action={action}
      />,
    );
    const trigger = document.querySelector('[data-transition-menu]') as HTMLElement;
    openMenu(trigger);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('data-transition-to'))).toEqual([
      'defects',
      'numbered',
    ]);
    fireEvent.click(items[1] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: tab.transition.confirm }));
    expect(await within(dialog).findAllByText(tab.transition.numberRequired)).not.toHaveLength(0);
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(tab.transition.number)), {
      target: { value: '77' },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(tab.transition.year)), {
      target: { value: '2026' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: tab.transition.confirm }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({
        workspaceId: WS,
        proceedingId: 'p1',
        to: 'numbered',
        number: '77',
        year: 2026,
      });
    });
    await waitFor(() => {
      expect(announcer().textContent).toBe('WP SR 4521 moved to Numbered.');
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('needs a reason to reopen a disposed proceeding', async () => {
    const action = vi.fn(() => ok({}));
    withIntl(
      <StateTransitionMenu
        workspaceId={WS}
        proceedingId="p1"
        label="WP 1/2026"
        state="disposed"
        transitions={['numbered']}
        action={action}
      />,
    );
    openMenu(document.querySelector('[data-transition-menu]') as HTMLElement);
    fireEvent.click(await screen.findByRole('menuitem'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(new RegExp(tab.transition.number)), {
      target: { value: '1' },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(tab.transition.year)), {
      target: { value: '2026' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: tab.transition.confirm }));
    expect(await within(dialog).findByText(tab.transition.reasonRequired)).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(tab.transition.reason)), {
      target: { value: 'Restored on review' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: tab.transition.confirm }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'numbered', reason: 'Restored on review' }),
      );
    });
  });

  it('asks for an optional cure deadline for defects, and Esc returns focus', async () => {
    const action = vi.fn(() => ok({}));
    withIntl(
      <StateTransitionMenu
        workspaceId={WS}
        proceedingId="p1"
        label="WP SR 1"
        state="sr_fr"
        transitions={['defects', 'numbered']}
        action={action}
      />,
    );
    const trigger = document.querySelector('[data-transition-menu]') as HTMLElement;
    openMenu(trigger);
    fireEvent.click((await screen.findAllByRole('menuitem'))[0] as HTMLElement);
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(tab.transition.cureDeadline)).toBeTruthy();
    expect(within(dialog).queryByLabelText(new RegExp(tab.transition.number))).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    openMenu(trigger);
    fireEvent.click((await screen.findAllByRole('menuitem'))[0] as HTMLElement);
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(tab.transition.cureDeadline), {
      target: { value: '2026-11-30' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: tab.transition.confirm }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({
        workspaceId: WS,
        proceedingId: 'p1',
        to: 'defects',
        cureDeadline: '2026-11-30',
      });
    });
  });
});

describe('ProceedingForm (#392)', () => {
  const types = FORUMS[0]?.caseTypes ?? [];

  it('matches case types in any punctuation and keeps free text', () => {
    const wp = types[0];
    if (wp === undefined) throw new Error('fixture');
    for (const typed of ['W.P.', 'wp', 'W P', 'writ petition']) {
      expect(caseTypeMatches(wp, typed), typed).toBe(true);
    }
    expect(caseTypeMatches(wp, 'O.S.')).toBe(false);
    expect(caseTypeComboOptions(types, 'w.p.').map((o) => o.value)).toEqual(['WP', 'WA']);
    expect(caseTypeComboOptions(types, 'O.S.')[0]).toEqual({ value: 'O.S.', label: 'O.S.' });
  });

  it('builds the create input without blank fields', () => {
    const draft: ProceedingDraft = {
      forumId: 'f1',
      caseType: ' W.P. ',
      number: '12345',
      year: '26',
      srNo: '',
      frNo: '',
      diaryNo: ' 88 ',
      filingNo: '',
      cnr: 'tnmd010012342026',
      parentId: 'p0',
      connected: '',
      appealFrom: '',
      lowerCourt: '',
    };
    expect(createInput({ workspaceId: WS, matterId: MATTER }, draft)).toEqual({
      workspaceId: WS,
      matterId: MATTER,
      forumId: 'f1',
      caseType: 'W.P.',
      number: '12345',
      year: 26,
      diaryNo: '88',
      cnr: 'TNMD010012342026',
      parentProceedingId: 'p0',
    });
  });

  function actions(overrides: Partial<ProceedingFormActions> = {}): ProceedingFormActions {
    return {
      create: vi.fn(() => ok({ id: 'new' })),
      update: vi.fn(() => ok({ id: 'p1' })),
      link: vi.fn(() => ok({})),
      findDuplicates: vi.fn(() => ok([])),
      ...overrides,
    };
  }

  it('creates a proceeding with its links, announces and closes', async () => {
    const acts = actions();
    const onClose = vi.fn();
    withIntl(
      <ProceedingForm
        workspaceId={WS}
        matterId={MATTER}
        forums={FORUMS}
        rows={[{ id: 'p0', label: 'WP 1/2020' }]}
        actions={acts}
        onClose={onClose}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: tab.form.save }));
    expect(await within(dialog).findAllByText(tab.form.required)).toHaveLength(2);
    expect(acts.create).not.toHaveBeenCalled();
    fireEvent.change(dialog.querySelector('[data-forum-select]') as HTMLSelectElement, {
      target: { value: 'f1' },
    });
    const combo = within(dialog).getByRole('combobox', { name: new RegExp(tab.form.caseType) });
    fireEvent.change(combo, { target: { value: 'w.p' } });
    expect(await screen.findByRole('option', { name: 'WP' })).toBeTruthy();
    fireEvent.change(combo, { target: { value: 'W.A.' } });
    fireEvent.change(within(dialog).getByLabelText(tab.form.number), { target: { value: '9' } });
    fireEvent.change(within(dialog).getByLabelText(tab.form.year), { target: { value: '2026' } });
    fireEvent.change(dialog.querySelector('[data-picker="appealFrom"]') as HTMLSelectElement, {
      target: { value: 'p0' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: tab.form.save }));
    await waitFor(() => {
      expect(acts.create).toHaveBeenCalledWith({
        workspaceId: WS,
        matterId: MATTER,
        forumId: 'f1',
        caseType: 'W.A.',
        number: '9',
        year: 2026,
      });
    });
    await waitFor(() => {
      expect(acts.link).toHaveBeenCalledWith({
        workspaceId: WS,
        fromProceedingId: 'new',
        toProceedingId: 'p0',
        kind: 'appeal_from',
      });
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    // The announcer clears and then sets its text on the next frame.
    await waitFor(() => {
      expect(announcer().textContent).toBe(tab.form.announceAdded);
    });
  });

  it('names every select of the proceeding form by its label', async () => {
    withIntl(
      <ProceedingForm
        workspaceId={WS}
        matterId={MATTER}
        forums={FORUMS}
        rows={[{ id: 'p0', label: 'WP 1/2020' }]}
        actions={actions()}
        onClose={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    for (const label of [
      tab.form.forum,
      tab.form.parent,
      tab.form.connected,
      tab.form.appealFrom,
      tab.form.lowerCourt,
    ]) {
      expect(
        within(dialog).getByRole('combobox', { name: new RegExp(`^${label}`) }),
        label,
      ).toBeTruthy();
    }
  });

  it('shows the duplicate prompt with Merge for a proceeding of another matter', async () => {
    const acts = actions({
      findDuplicates: vi.fn(() =>
        ok([
          {
            id: 'dup',
            matterId: 'm-2',
            sameMatter: false,
            caseType: 'WP',
            number: '12345',
            year: 2026,
            cnr: null,
          },
        ]),
      ),
    });
    const onMergeMatter = vi.fn();
    withIntl(
      <ProceedingForm
        workspaceId={WS}
        matterId={MATTER}
        forums={FORUMS}
        rows={[]}
        actions={acts}
        onClose={vi.fn()}
        onMergeMatter={onMergeMatter}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const combo = within(dialog).getByRole('combobox', { name: new RegExp(tab.form.caseType) });
    fireEvent.change(combo, { target: { value: 'WP' } });
    fireEvent.change(within(dialog).getByLabelText(tab.form.number), {
      target: { value: '12345' },
    });
    const year = within(dialog).getByLabelText(tab.form.year);
    fireEvent.change(year, { target: { value: '2026' } });
    fireEvent.blur(year);
    expect(
      await within(dialog).findByText('Looks like WP 12345/2026 which is already here. Merge?'),
    ).toBeTruthy();
    expect(acts.findDuplicates).toHaveBeenCalledWith({
      workspaceId: WS,
      matterId: MATTER,
      identity: { caseType: 'WP', number: '12345', year: 2026 },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: tab.form.merge }));
    expect(onMergeMatter).toHaveBeenCalledWith('m-2');
  });
});

const preview = (overrides: Partial<MovePreviewView> = {}): MovePreviewView => ({
  proceedings: [{ id: 'p9', caseType: 'WP', number: '9', year: 2026 }],
  documents: 2,
  obligations: 1,
  crossingLinks: 0,
  intoSensitive: false,
  fromSensitive: false,
  blocked: null,
  ...overrides,
});

/** The Undo of the last toast, as sonner would call it. */
function undoOfLastToast() {
  const call = toast.success.mock.calls[0] as unknown as [
    string,
    { duration: number; action: { label: string; onClick: () => void } },
  ];
  return call[1];
}

describe('MergeMatterDialog and SplitMatterDialog (#392)', () => {
  it('explains why a sensitive matter cannot be merged and offers no Merge', async () => {
    const merge = vi.fn();
    withIntl(
      <MergeMatterDialog
        workspaceId={WS}
        matterId={MATTER}
        initialMatterId="m-2"
        actions={{
          search: vi.fn(),
          preview: vi.fn(() => ok(preview({ fromSensitive: true, blocked: 'sensitive' }))),
          merge,
          undo: vi.fn(),
        }}
        onClose={vi.fn()}
      />,
    );
    const blocked = await screen.findByText(tab.merge.blocked.sensitive);
    expect(blocked.closest('[data-move-blocked="sensitive"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: tab.merge.confirm })).toBeNull();
    expect(merge).not.toHaveBeenCalled();
  });

  it('searches, previews what moves, merges and offers Undo for 10 seconds', async () => {
    const payload = { op: 'matter.merge' };
    const acts = {
      search: vi.fn(() =>
        ok([
          { id: MATTER, title: 'This matter', forum: null, sensitive: false },
          { id: 'm-2', title: 'Rao v. Union', forum: 'Madras HC', sensitive: false },
        ]),
      ),
      preview: vi.fn(() => ok(preview())),
      merge: vi.fn(() => ok({ undo: payload })),
      undo: vi.fn(() => ok({})),
    };
    const onClose = vi.fn();
    withIntl(
      <MergeMatterDialog workspaceId={WS} matterId={MATTER} actions={acts} onClose={onClose} />,
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('[data-merge-search]') as HTMLInputElement, {
      target: { value: 'Rao' },
    });
    const hit = await within(dialog).findByRole('button', { name: /Rao v\. Union/ });
    expect(within(dialog).queryByRole('button', { name: /This matter/ })).toBeNull();
    fireEvent.click(hit);
    expect(await within(dialog).findByText('2 documents')).toBeTruthy();
    expect(within(dialog).getByText('1 obligation')).toBeTruthy();
    expect(dialog.querySelector('[data-moves="proceedings"]')?.textContent).toContain('WP 9/2026');
    expect(acts.preview).toHaveBeenCalledWith({
      workspaceId: WS,
      intoMatterId: MATTER,
      fromMatterId: 'm-2',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: tab.merge.confirm }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(acts.merge).toHaveBeenCalledWith({
      workspaceId: WS,
      intoMatterId: MATTER,
      fromMatterId: 'm-2',
    });
    const options = undoOfLastToast();
    expect(options.duration).toBe(UNDO_WINDOW_MS);
    expect(UNDO_WINDOW_MS).toBe(10_000);
    expect(options.action.label).toBe(tab.undo.action);
    await act(async () => {
      options.action.onClick();
      options.action.onClick();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(acts.undo).toHaveBeenCalledTimes(1);
    });
    expect(acts.undo).toHaveBeenCalledWith({ workspaceId: WS, payload });
  });

  it('splits the selected proceedings after a title, and an undo conflict says so', async () => {
    const payload = { op: 'matter.split' };
    const acts = {
      preview: vi.fn(() => ok(preview({ documents: 0, obligations: 2, crossingLinks: 1 }))),
      split: vi.fn(() => ok({ undo: payload, newMatterHref: '/w/demo/matters/m-3' })),
      undo: vi.fn(() =>
        Promise.resolve({ ok: false as const, error: { code: 'CONFLICT' as const, message: '' } }),
      ),
    };
    const onDone = vi.fn();
    withIntl(
      <SplitMatterDialog
        workspaceId={WS}
        slug="demo"
        matterId={MATTER}
        proceedingIds={['p9']}
        actions={acts}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('2 obligations')).toBeTruthy();
    expect(within(dialog).getByText('1 link stays across the two matters')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: tab.split.confirm }));
    expect(await within(dialog).findByText(tab.split.titleRequired)).toBeTruthy();
    expect(acts.split).not.toHaveBeenCalled();
    fireEvent.change(dialog.querySelector('[data-split-title]') as HTMLInputElement, {
      target: { value: 'Writ appeal' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: tab.split.confirm }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(acts.split).toHaveBeenCalledWith({
      workspaceId: WS,
      slug: 'demo',
      matterId: MATTER,
      proceedingIds: ['p9'],
      newTitle: 'Writ appeal',
    });
    await act(async () => {
      undoOfLastToast().action.onClick();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(tab.undo.conflict);
    });
    expect(acts.undo).toHaveBeenCalledWith({ workspaceId: WS, payload });
  });

  it('previews a split once on open and drops a preview that answers after the dialog closed', async () => {
    let answer: (value: { ok: true; data: MovePreviewView }) => void = () => undefined;
    const acts = {
      preview: vi.fn(
        () =>
          new Promise<{ ok: true; data: MovePreviewView }>((resolve) => {
            answer = resolve;
          }),
      ),
      split: vi.fn(),
      undo: vi.fn(),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = withIntl(
      <SplitMatterDialog
        workspaceId={WS}
        slug="demo"
        matterId={MATTER}
        proceedingIds={['p9', 'p10']}
        actions={acts}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(acts.preview).toHaveBeenCalledTimes(1);
    });
    expect(acts.preview).toHaveBeenCalledWith({
      workspaceId: WS,
      matterId: MATTER,
      proceedingIds: ['p9', 'p10'],
    });
    unmount();
    await act(async () => {
      answer({ ok: true, data: preview({ obligations: 2 }) });
      await Promise.resolve();
    });
    expect(screen.queryByText('2 obligations')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
