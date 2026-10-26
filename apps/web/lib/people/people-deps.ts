// Server-only seam between the People screens and the contact services (#848, #82 part 2). The
// services take `PeopleDeps` and open the actor's workspace scope themselves; the app hands them the
// transaction it already holds (`inWorkspace` here, `ctx.tx` in server actions), and never imports
// `db` (#298). The events ports are no-ops: nothing subscribes to `contact.language_changed` yet.
//
// The list's filters (search, kind, language) live in the URL and are applied here over
// `listContacts`, which returns the workspace's contacts already limited to what the role may see.
import type {
  ContactDetail,
  ContactView,
  PeopleDeps,
  PeopleEvents,
} from '@causedeck/core/people';
import type { Transaction } from '@causedeck/core/runtime';
import { CONTACT_KINDS, LANGUAGE_PREFS } from '@causedeck/validators/client-contact';
import type { ContactKind, LanguagePref } from '@causedeck/validators/client-contact';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

const NO_EVENTS: PeopleEvents = {
  emit() {
    // No subscribers yet (see the header).
  },
};

/** The people deps for a transaction the caller already opened. */
export function peopleDeps(tx: Transaction): PeopleDeps {
  return { db: tx, events: NO_EVENTS, graphEvents: { emit: () => undefined } };
}

export type SearchParams = Record<string, string | string[] | undefined>;

/** What the list shows, all from the URL. */
export interface ContactListState {
  q: string;
  kind: ContactKind | undefined;
  language: LanguagePref | undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Read the list state from the query; an unknown kind or language is ignored. */
export function parseContactListState(query: SearchParams): ContactListState {
  const kind = first(query.kind);
  const language = first(query.language);
  return {
    q: (first(query.q) ?? '').trim().slice(0, 100),
    kind: CONTACT_KINDS.find((k) => k === kind),
    language: LANGUAGE_PREFS.find((l) => l === language),
  };
}

export function hasContactFilters(state: ContactListState): boolean {
  return state.q !== '' || state.kind !== undefined || state.language !== undefined;
}

/** The list URL for `state` (empty parts left out). */
export function contactListHref(slug: string, state: Partial<ContactListState> = {}): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.kind) params.set('kind', state.kind);
  if (state.language) params.set('language', state.language);
  const qs = params.toString();
  return `/w/${encodeURIComponent(slug)}/people${qs === '' ? '' : `?${qs}`}`;
}

/** The contacts that match the search (name, phone or email, case-insensitive) and the filters. */
export function filterContacts(
  contacts: readonly ContactView[],
  state: ContactListState,
): ContactView[] {
  const needle = state.q.toLowerCase();
  const digits = needle.replace(/[^\d+]/g, '');
  return contacts.filter((c) => {
    if (state.kind !== undefined && c.kind !== state.kind) return false;
    if (state.language !== undefined && c.languagePref !== state.language) return false;
    if (needle === '') return true;
    return (
      c.personName.toLowerCase().includes(needle) ||
      (c.email?.toLowerCase().includes(needle) ?? false) ||
      (digits.length > 0 && (c.phone?.includes(digits) ?? false))
    );
  });
}

/** The code of a domain error (`WorkspaceError`), if `error` is one. */
function domainErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return /Error$/.test(error.name) ? error.code : undefined;
  }
  return undefined;
}

export type ContactsLoad =
  | { kind: 'list'; contacts: ContactView[] }
  | { kind: 'denied' }
  | { kind: 'error' };

/** The workspace's contacts for the member; a denial and a failure are results, never a throw. */
export async function loadContacts(context: WorkspaceContext): Promise<ContactsLoad> {
  try {
    const [runtime, people] = await Promise.all([
      import('@causedeck/core/runtime'),
      import('@causedeck/core/people'),
    ]);
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    const contacts = await runtime.inWorkspace(scope, (tx) =>
      people.listContacts(peopleDeps(tx), scope),
    );
    return { kind: 'list', contacts };
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'FORBIDDEN') return { kind: 'denied' };
    logger.error({ err: error }, 'people page: could not load the contacts');
    return { kind: 'error' };
  }
}

export type ContactDetailLoad =
  | { kind: 'detail'; detail: ContactDetail }
  | { kind: 'not-found' }
  | { kind: 'denied' }
  | { kind: 'error' };

/** One contact with its linked matters and log; NOT_FOUND covers another workspace's contact. */
export async function loadContactDetail(
  context: WorkspaceContext,
  contactId: string,
): Promise<ContactDetailLoad> {
  try {
    const [runtime, people] = await Promise.all([
      import('@causedeck/core/runtime'),
      import('@causedeck/core/people'),
    ]);
    const scope = { workspaceId: context.workspace.id, userId: context.user.id };
    const detail = await runtime.inWorkspace(scope, (tx) =>
      people.getContactDetail(peopleDeps(tx), scope, { contactId }),
    );
    return { kind: 'detail', detail };
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'FORBIDDEN') return { kind: 'denied' };
    if (code === 'NOT_FOUND') return { kind: 'not-found' };
    logger.error({ err: error }, 'people page: could not load the contact');
    return { kind: 'error' };
  }
}

/** One contact as the client components receive it: plain values, the link already built. */
export interface ContactRowView {
  id: string;
  href: string;
  personName: string;
  kind: ContactKind;
  languagePref: LanguagePref;
  phone: string | null;
  email: string | null;
  linkedCount: number;
  unlinked: boolean;
  archived: boolean;
  redacted: boolean;
}

export function toContactRowView(contact: ContactView, slug: string): ContactRowView {
  return {
    id: contact.id,
    href: `/w/${encodeURIComponent(slug)}/people/${contact.id}`,
    personName: contact.personName,
    kind: contact.kind,
    languagePref: contact.languagePref,
    phone: contact.phone,
    email: contact.email,
    linkedCount: contact.linkedCount,
    unlinked: contact.unlinked,
    archived: contact.archivedAt !== null,
    redacted: contact.redacted,
  };
}
