// @vitest-environment jsdom
// The People tab (#393, #40 part 5): people grouped by role edge in ROLE_EDGE_KINDS order (empty
// groups left out), who they are, their other names, contact details only for clients and
// professional contacts; Add person, Edit and Remove only for members with `matter.write` (absent,
// not disabled, for clerks and viewers); the empty state with one primary action; the
// not-found, permission-denied and error results of the loader; the tab registered for every role
// that reads matters; the loading and error screens. `PersonForm` offers contact fields only for
// clients and professional contacts, drops them when the kind changes (an edit then sends
// `contact: null`) and sends a new person's role with them. Every name is fictional.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatterPeopleGroup } from '@causedeck/core/matter-graph';

import { MatterAnnouncer } from '../components/matters/matter-announcer.tsx';
import { PersonForm, personInput } from '../components/matters/person-form.tsx';
import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';
import { toPeopleView } from '../lib/matters/people.ts';
import { matterTabs, resetMatterTabs } from '../lib/matters/tab-registry.ts';
import { registerMatterTabs } from '../lib/matters/tabs.ts';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const MATTER_ID = '00000000-0000-4000-8000-000000000001';
const PROCEEDING_ID = '00000000-0000-4000-8000-0000000000b1';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  groups: [] as MatterPeopleGroup[],
  error: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const graph = vi.hoisted(() => ({
  listMatterPeople: vi.fn(() =>
    page.error === null ? Promise.resolve(page.groups) : Promise.reject(page.error),
  ),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());
const peopleActions = vi.hoisted(() => ({
  upsertPersonAction: vi.fn(),
  setRoleEdgeAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => `/w/demo/matters/${MATTER_ID}/people`,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
  getLocale: () => Promise.resolve('en'),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('../lib/report-error.ts', () => ({ reportError }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/matter-graph', () => graph);
vi.mock('../app/(app)/w/[slug]/matters/[id]/people/actions.ts', () => peopleActions);

const { default: PeoplePage, generateMetadata } =
  await import('../app/(app)/w/[slug]/matters/[id]/people/page.tsx');
const { default: PeopleLoading } =
  await import('../app/(app)/w/[slug]/matters/[id]/people/loading.tsx');
const { default: PeopleError } =
  await import('../app/(app)/w/[slug]/matters/[id]/people/error.tsx');

const ws = catalogs.en.matters.workspace;
const people = ws.people;
const params = Promise.resolve({ slug: 'demo', id: MATTER_ID });

const manual = { sourceType: 'manual', confirmationState: 'confirmed' } as const;

function groups(): MatterPeopleGroup[] {
  return [
    {
      kind: 'represents',
      edges: [
        {
          edgeId: 'e1',
          proceedingId: null,
          person: {
            id: 'p1',
            name: 'K. Rao',
            aliases: ['Rao K.', 'கே. ராவ்'],
            kind: 'client',
            contact: { email: 'rao@example.test', phone: '98400 00000' },
          },
          provenance: manual,
        },
        // The same client on a proceeding: listed once.
        {
          edgeId: 'e1b',
          proceedingId: PROCEEDING_ID,
          person: { id: 'p1', name: 'K. Rao', aliases: [], kind: 'client', contact: null },
          provenance: manual,
        },
      ],
    },
    { kind: 'appears_for', edges: [] },
    { kind: 'instructed_by', edges: [] },
    {
      kind: 'assigned_to',
      edges: [
        {
          edgeId: 'e3',
          proceedingId: null,
          person: { id: 'p3', name: 'M. Clerk', aliases: [], kind: 'other', contact: null },
          provenance: manual,
        },
      ],
    },
    {
      kind: 'opposes',
      edges: [
        {
          edgeId: 'e2',
          proceedingId: PROCEEDING_ID,
          person: {
            id: 'p2',
            name: 'Government Pleader',
            aliases: [],
            kind: 'judge_staff',
            // A stored contact on another kind never reaches the page.
            contact: { phone: '044 0000 0000' },
          },
          provenance: manual,
        },
      ],
    },
  ];
}

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      <MatterAnnouncer>{ui}</MatterAnnouncer>
    </NextIntlClientProvider>,
  );

async function renderPage(query: Record<string, string> = {}) {
  const content = await PeoplePage({ params, searchParams: Promise.resolve(query) });
  return withIntl(content);
}

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(readonly code: string) {
    super(code);
  }
}

function as(role: Role) {
  page.context = testWorkspaceContext('demo', role);
}

beforeEach(() => {
  stubResizeObserver();
  mockMatchMedia({});
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  as('owner');
  page.dev = true;
  page.groups = groups();
  page.error = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetMatterTabs();
});

describe('People tab (#393)', () => {
  it('groups people by role edge in order, once each, with kinds and other names', async () => {
    await renderPage();
    const sections = [...document.querySelectorAll('[data-people-group]')];
    expect(sections.map((s) => s.getAttribute('data-people-group'))).toEqual([
      'represents',
      'assigned_to',
      'opposes',
    ]);
    const represents = sections[0] as HTMLElement;
    expect(within(represents).getByRole('heading', { name: people.kinds.represents })).toBeTruthy();
    expect(represents.querySelectorAll('[data-person]')).toHaveLength(1);
    expect(within(represents).getByText(people.personKinds.client)).toBeTruthy();
    expect(within(represents).getByText(people.onProceeding)).toBeTruthy();
    expect(represents.querySelector('[data-person-aliases]')?.textContent).toBe(
      'Also known as Rao K., கே. ராவ்',
    );
    const opposes = sections[2] as HTMLElement;
    expect(within(opposes).getByText(people.personKinds.judge_staff)).toBeTruthy();
    expect(graph.listMatterPeople).toHaveBeenCalledWith(
      expect.objectContaining({ db: { tx: true } }),
      { workspaceId: page.context?.workspace.id, userId: page.context?.user.id },
      { matterId: MATTER_ID },
    );
  });

  it('marks the populated list with [data-people]', async () => {
    await renderPage();
    const list = document.querySelector('[data-people]') as HTMLElement;
    expect(list.getAttribute('data-people')).toBe('list');
    expect(list.querySelectorAll('[data-person]').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-people="empty"]')).toBeNull();
  });

  it('shows contact details only for clients and professional contacts', async () => {
    await renderPage();
    const contacts = [...document.querySelectorAll('[data-person-contact]')];
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.closest('[data-person]')?.getAttribute('data-person')).toBe('p1');
    expect(contacts[0]?.textContent).toContain('rao@example.test');
    expect(document.body.textContent).not.toContain('044 0000 0000');
  });

  it('gives writers Add, Edit and Remove; Remove only for a role held on the matter', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: people.add })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit K. Rao' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove K. Rao from this matter' })).toBeTruthy();
    // The pleader's role is on a proceeding: changed on the Proceedings tab, not removed here.
    expect(
      screen.queryByRole('button', { name: 'Remove Government Pleader from this matter' }),
    ).toBeNull();
    expect(document.querySelector('[data-people-import]')).toBeNull();
  });

  it('keeps the visible text of every Edit button inside its accessible name', async () => {
    await renderPage();
    const buttons = document.querySelectorAll<HTMLButtonElement>('[data-person-edit]');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toContain(button.textContent);
    }
  });

  it.each(['viewer', 'clerk'] as const)('gives a %s no mutation controls at all', async (role) => {
    as(role);
    await renderPage();
    for (const selector of [
      '[data-people-add]',
      '[data-person-edit]',
      '[data-person-remove]',
      '[data-slot="person-form"]',
    ]) {
      expect(document.querySelector(selector), selector).toBeNull();
    }
    expect(document.querySelectorAll('[data-person]').length).toBeGreaterThan(0);
  });

  it('removes a role after confirmation and announces it', async () => {
    peopleActions.setRoleEdgeAction.mockResolvedValue({ ok: true, data: { removed: true } });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Remove K. Rao from this matter' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(people.removeHint)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: people.removeConfirm }));
    await waitFor(() => {
      expect(peopleActions.setRoleEdgeAction).toHaveBeenCalledWith({
        workspaceId: page.context?.workspace.id,
        matterId: MATTER_ID,
        personId: 'p1',
        kind: 'represents',
        remove: true,
      });
    });
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled();
    });
  });

  it('has an empty state with one primary action for writers, none for viewers', async () => {
    page.groups = groups().map((group) => ({ ...group, edges: [] }));
    await renderPage();
    const empty = document.querySelector('[data-people="empty"]') as HTMLElement;
    expect(within(empty).getByText(people.empty)).toBeTruthy();
    expect(within(empty).getAllByRole('button')).toHaveLength(1);
    cleanup();
    as('viewer');
    await renderPage();
    const forViewer = document.querySelector('[data-people="empty"]') as HTMLElement;
    expect(within(forViewer).queryAllByRole('button')).toHaveLength(0);
  });

  it('is a not-found for another workspace or an unknown matter', async () => {
    page.error = new WorkspaceError('NOT_FOUND');
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    page.error = new WorkspaceError('VALIDATION');
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows permission-denied on FORBIDDEN and throws to the boundary on errors', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    await renderPage();
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
    cleanup();
    page.error = new Error('db down');
    await expect(renderPage()).rejects.toThrow('Matter people could not be loaded');
    expect(logger.error).toHaveBeenCalledWith({ err: page.error }, expect.any(String));
  });

  it('previews the states in development only', async () => {
    await renderPage({ __state: 'empty' });
    expect(document.querySelector('[data-people="empty"]')).not.toBeNull();
    cleanup();
    await renderPage({ __state: 'denied' });
    expect(screen.getByText(catalogs.en.matters.denied)).toBeTruthy();
    cleanup();
    await expect(renderPage({ __state: 'error' })).rejects.toThrow();
    page.dev = false;
    await renderPage({ __state: 'empty' });
    expect(document.querySelector('[data-people="empty"]')).toBeNull();
  });

  it('names the page and has loading and error screens', async () => {
    expect(await generateMetadata()).toEqual({ title: ws.tabs.people });
    withIntl(<PeopleLoading />);
    expect(document.querySelector('[data-slot="people-skeleton"]')).not.toBeNull();
    cleanup();
    const reset = vi.fn();
    const error = Object.assign(new Error('secret party name'), { digest: 'ref-7' });
    withIntl(<PeopleError error={error} reset={reset} />);
    expect(screen.getByText(people.error.title)).toBeTruthy();
    expect(screen.getByText('Reference: ref-7')).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret party name');
    fireEvent.click(screen.getByRole('button', { name: people.error.retry }));
    expect(reset).toHaveBeenCalled();
  });

  it('is registered after Overview for every role that reads matters', () => {
    registerMatterTabs();
    for (const role of ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const) {
      expect(matterTabs(role).map((tab) => tab.id)).toContain('people');
    }
    expect(matterTabs('viewer').find((tab) => tab.id === 'people')).toMatchObject({
      segment: 'people',
      labelKey: 'people',
      order: 20,
    });
  });
});

describe('toPeopleView (#393)', () => {
  it('keeps every role kind, people once per group, contact only for contact kinds', () => {
    const view = toPeopleView(groups());
    expect(view.map((g) => g.kind)).toEqual([
      'represents',
      'appears_for',
      'instructed_by',
      'assigned_to',
      'opposes',
    ]);
    expect(view[0]?.people).toEqual([
      {
        id: 'p1',
        name: 'K. Rao',
        aliases: ['Rao K.', 'கே. ராவ்'],
        kind: 'client',
        contact: { email: 'rao@example.test', phone: '98400 00000', address: null },
        onMatter: true,
        onProceeding: true,
      },
    ]);
    expect(view[4]?.people[0]).toMatchObject({ contact: null, onMatter: false });
  });
});

describe('PersonForm (#393)', () => {
  function renderForm(props: Partial<Parameters<typeof PersonForm>[0]> = {}) {
    const action = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { id: 'p9', name: 'N' } }),
    );
    withIntl(
      <PersonForm
        workspaceId="ws-1"
        matterId={MATTER_ID}
        action={action}
        open
        onOpenChange={() => undefined}
        {...props}
      />,
    );
    return action;
  }

  it('offers contact fields only for clients and professional contacts', () => {
    renderForm();
    const kind = document.querySelector('[data-person-field="kind"]') as HTMLSelectElement;
    expect(kind.value).toBe('party');
    expect(document.querySelector('[data-person-field="contact"]')).toBeNull();
    for (const value of ['client', 'professional']) {
      fireEvent.change(kind, { target: { value } });
      expect(document.querySelector('[data-person-field="contact"]'), value).not.toBeNull();
    }
    for (const value of ['advocate', 'judge_staff', 'other']) {
      fireEvent.change(kind, { target: { value } });
      expect(document.querySelector('[data-person-field="contact"]'), value).toBeNull();
    }
  });

  it('adds a person with other names, a role and a contact', async () => {
    const action = renderForm();
    fireEvent.change(document.querySelector('[data-person-field="name"]') as HTMLInputElement, {
      target: { value: ' N. Iyer ' },
    });
    fireEvent.click(screen.getByRole('button', { name: people.form.addAlias }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Other name 1' }), {
      target: { value: 'Iyer N.' },
    });
    fireEvent.change(document.querySelector('[data-person-field="kind"]') as HTMLSelectElement, {
      target: { value: 'professional' },
    });
    fireEvent.change(document.querySelector('[data-person-field="role"]') as HTMLSelectElement, {
      target: { value: 'instructed_by' },
    });
    fireEvent.change(document.querySelector('[data-person-field="email"]') as HTMLInputElement, {
      target: { value: 'iyer@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: people.form.save }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        matterId: MATTER_ID,
        person: {
          name: 'N. Iyer',
          aliases: ['Iyer N.'],
          kind: 'professional',
          contact: { email: 'iyer@example.test' },
        },
        role: { kind: 'instructed_by' },
      });
    });
  });

  it('refuses a blank name and a malformed email without calling the action', () => {
    const action = renderForm();
    fireEvent.change(document.querySelector('[data-person-field="kind"]') as HTMLSelectElement, {
      target: { value: 'client' },
    });
    fireEvent.change(document.querySelector('[data-person-field="email"]') as HTMLInputElement, {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: people.form.save }));
    expect(screen.getByText(people.form.errors.name)).toBeTruthy();
    expect(screen.getByText(people.form.errors.email)).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it('clears a stored contact when an edit moves the person to another kind', () => {
    const person = {
      id: 'p1',
      name: 'K. Rao',
      aliases: ['Rao K.'],
      kind: 'client' as const,
      contact: { email: 'rao@example.test', phone: null, address: null },
    };
    const draft = {
      name: 'K. Rao',
      aliases: ['Rao K.', ' '],
      kind: 'party' as const,
      role: 'represents' as const,
      email: 'rao@example.test',
      phone: '',
      address: '',
    };
    expect(personInput(draft, { workspaceId: 'ws-1', matterId: MATTER_ID, person })).toEqual({
      workspaceId: 'ws-1',
      matterId: MATTER_ID,
      person: { personId: 'p1', name: 'K. Rao', aliases: ['Rao K.'], kind: 'party', contact: null },
    });
    // A new person of another kind sends no contact at all, and their role.
    expect(
      personInput(draft, { workspaceId: 'ws-1', matterId: MATTER_ID, person: undefined }),
    ).toEqual({
      workspaceId: 'ws-1',
      matterId: MATTER_ID,
      person: { name: 'K. Rao', aliases: ['Rao K.'], kind: 'party' },
      role: { kind: 'represents' },
    });
  });

  it('shows the edit form without a role picker and maps a refusal', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'FORBIDDEN' as const, message: '' } }),
    );
    withIntl(
      <PersonForm
        workspaceId="ws-1"
        matterId={MATTER_ID}
        action={action}
        open
        onOpenChange={() => undefined}
        person={{ id: 'p1', name: 'K. Rao', aliases: [], kind: 'party', contact: null }}
      />,
    );
    expect(screen.getByRole('heading', { name: people.form.editTitle })).toBeTruthy();
    expect(document.querySelector('[data-person-field="role"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: people.form.save }));
    expect(await screen.findByText(people.form.errors.forbidden)).toBeTruthy();
  });

  it('cannot save while offline', () => {
    const action = renderForm({ offline: true });
    expect(screen.getByText(ws.offlineAction)).toBeTruthy();
    const save = screen.getByRole<HTMLButtonElement>('button', { name: people.form.save });
    expect(save.disabled).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });
});
