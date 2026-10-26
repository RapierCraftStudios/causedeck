// @vitest-environment jsdom
// The People screens (#848): the list filters and search (people-deps), the list's states and
// shortcuts (`n`, `/`, `Enter`, `Esc`), and the new-contact form (its checks and its action call).
import type { ContactView } from '@causedeck/core/people';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContactList } from '../app/(app)/w/[slug]/people/_components/contact-list.tsx';
import {
  contactListHref,
  filterContacts,
  parseContactListState,
  toContactRowView,
} from '../lib/people/people-deps.ts';

import { catalogs } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function contact(n: number, over: Partial<ContactView> = {}): ContactView {
  return {
    id: `c${String(n)}`,
    personId: `p${String(n)}`,
    personName: `Client ${String(n)}`,
    kind: 'primary',
    phone: `+91987654321${String(n)}`,
    email: `client${String(n)}@example.test`,
    languagePref: 'en',
    linkedCount: n === 2 ? 0 : 1,
    unlinked: n === 2,
    archivedAt: null,
    redacted: false,
    ...over,
  } as ContactView;
}

const CONTACTS = [
  contact(1),
  contact(2, { kind: 'family', languagePref: 'ta' }),
  contact(3, { languagePref: 'hi' }),
];

describe('people list state', () => {
  it('parses the query, ignoring unknown kinds and languages', () => {
    expect(parseContactListState({ q: ' rao ', kind: 'family', language: 'xx' })).toEqual({
      q: 'rao',
      kind: 'family',
      language: undefined,
    });
    expect(contactListHref('demo', { q: 'a', kind: 'family' })).toBe(
      '/w/demo/people?q=a&kind=family',
    );
  });

  it('filters by name, phone, email, kind and language', () => {
    const f = (q: Record<string, string>) => filterContacts(CONTACTS, parseContactListState(q));
    expect(f({ q: 'client 3' }).map((c) => c.id)).toEqual(['c3']);
    expect(f({ q: '9876543212' }).map((c) => c.id)).toEqual(['c2']);
    expect(f({ q: 'CLIENT1@' }).map((c) => c.id)).toEqual(['c1']);
    expect(f({ kind: 'family' }).map((c) => c.id)).toEqual(['c2']);
    expect(f({ language: 'hi' }).map((c) => c.id)).toEqual(['c3']);
  });
});

const withIntl = (ui: ReactNode) =>
  render(
    createElement(NextIntlClientProvider, {
      locale: 'en',
      messages: catalogs.en,
      timeZone: 'Asia/Kolkata',
      children: ui,
    }),
  );

const createAction = vi.fn(() =>
  Promise.resolve({ ok: true as const, data: { id: 'c9', personId: 'p9' } }),
);

function list(over: Partial<Parameters<typeof ContactList>[0]> = {}) {
  return createElement(ContactList, {
    slug: 'demo',
    workspaceId: 'w1',
    contacts: CONTACTS.map((c) => toContactRowView(c, 'demo')),
    q: '',
    kind: undefined,
    language: undefined,
    canWrite: true,
    createAction,
    ...over,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ContactList', () => {
  it('shows the linked count and the Not linked flag', () => {
    withIntl(list());
    expect(document.querySelectorAll('[data-contact-row]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-contact-unlinked]')).toHaveLength(1);
    expect(screen.getByText('No linked matters')).toBeTruthy();
  });

  it('shows the empty and filtered-empty states', () => {
    withIntl(list({ contacts: [] }));
    expect(screen.getByText('No contacts yet')).toBeTruthy();
    cleanup();
    withIntl(list({ contacts: [], q: 'zzz' }));
    expect(screen.getByText('No contacts match these filters')).toBeTruthy();
  });

  it('shows the offline banner', () => {
    withIntl(list({ forceOffline: true }));
    expect(document.querySelector('[data-contacts-offline]')).not.toBeNull();
  });

  it('`/` focuses the search; `n` opens the form; Esc closes it', async () => {
    withIntl(list());
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('`n` does nothing for a viewer; `j` then Enter opens the contact', () => {
    withIntl(list({ canWrite: false }));
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'j' });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(document.activeElement?.getAttribute('data-contact-row')).toBe('c1');
  });
});

describe('ContactForm', () => {
  it('needs a phone or an email, then calls the action with the client name', async () => {
    withIntl(list());
    fireEvent.click(screen.getByRole('button', { name: 'New contact' }));
    const dialog = await screen.findByRole('dialog');
    const field = (name: string) =>
      dialog.querySelector<HTMLInputElement>(`[data-contact-field="${name}"]`) as HTMLInputElement;
    fireEvent.change(field('client'), { target: { value: 'Asha Rao' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByText('Give a phone or an email.')).toBeTruthy();
    expect(createAction).not.toHaveBeenCalled();

    fireEvent.change(field('phone'), { target: { value: '+919876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    await waitFor(() => {
      expect(createAction).toHaveBeenCalled();
    });
    expect(createAction).toHaveBeenCalledWith({
      workspaceId: 'w1',
      clientName: 'Asha Rao',
      kind: 'primary',
      languagePref: 'en',
      phone: '+919876543210',
    });
    expect(router.refresh).toHaveBeenCalled();
  });
});
