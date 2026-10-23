// Server-only loader for the People tab (#393, #40 part 5). `listMatterPeople`
// (`@causedeck/core/matter-graph`) runs in the member's workspace scope and decides `matter.read`
// per matter: another workspace's matter, a restricted matter and a malformed id all come back as
// `not-found`. `toPeopleView` turns the role-edge groups into what `PeoplePanel` renders: each person
// once per group, contact details only for clients and professional contacts (the core keeps
// them only there; the view drops anything else as a second guard). Only the error object is
// logged, never a name or a contact.
import type { MatterPeopleGroup } from '@causedeck/core/matter-graph';
import { CONTACT_PERSON_KINDS } from '@causedeck/validators/matter-graph-inputs';
import { cache } from 'react';

import { logger } from '../../src/health.ts';
import type { WorkspaceContext } from '../workspace-context.ts';

import { domainErrorCode, graphDeps } from './graph-deps.ts';

export type MatterPeopleLoad =
  | { kind: 'people'; groups: MatterPeopleGroup[] }
  | { kind: 'not-found' }
  | { kind: 'denied' }
  | { kind: 'error' };

const loadPeople = cache(
  async (workspaceId: string, userId: string, matterId: string): Promise<MatterPeopleLoad> => {
    try {
      // One at a time, not in a Promise.all: concurrent imports race the test mocks.
      const { inWorkspace } = await import('@causedeck/core/runtime');
      const { listMatterPeople } = await import('@causedeck/core/matter-graph');
      const scope = { workspaceId, userId };
      const groups = await inWorkspace(scope, (tx) =>
        listMatterPeople(graphDeps(tx), scope, { matterId }),
      );
      return { kind: 'people', groups };
    } catch (error) {
      const code = domainErrorCode(error);
      if (code === 'NOT_FOUND' || code === 'VALIDATION') return { kind: 'not-found' };
      if (code === 'FORBIDDEN') return { kind: 'denied' };
      logger.error({ err: error }, 'matter people: could not load the people of the matter');
      return { kind: 'error' };
    }
  },
);

/** The matter's people for the signed-in member. */
export function loadMatterPeople(
  context: WorkspaceContext,
  matterId: string,
): Promise<MatterPeopleLoad> {
  return loadPeople(context.workspace.id, context.user.id, matterId);
}

export type RoleEdgeKindView = MatterPeopleGroup['kind'];
export type PersonKindView = MatterPeopleGroup['edges'][number]['person']['kind'];

export interface PersonContactView {
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface PersonEntryView {
  id: string;
  name: string;
  aliases: string[];
  kind: PersonKindView;
  /** Only for clients and professional contacts. */
  contact: PersonContactView | null;
  /** The person holds this role on the matter itself, so it can be removed here. */
  onMatter: boolean;
  /** The person holds this role on one or more of the matter's proceedings. */
  onProceeding: boolean;
}

export interface PeopleGroupView {
  kind: RoleEdgeKindView;
  people: PersonEntryView[];
}

const CONTACT_KINDS: ReadonlySet<string> = new Set(CONTACT_PERSON_KINDS);

/** Contact kinds: the only kinds the form offers contact fields for. */
export function takesContact(kind: string): boolean {
  return CONTACT_KINDS.has(kind);
}

/** One group per role-edge kind, in the core's order (`ROLE_EDGE_KINDS`), empty ones included. */
export function toPeopleView(groups: readonly MatterPeopleGroup[]): PeopleGroupView[] {
  return groups.map((group) => {
    const seen = new Map<string, PersonEntryView>();
    for (const edge of group.edges) {
      const { person } = edge;
      const entry = seen.get(person.id) ?? {
        id: person.id,
        name: person.name,
        aliases: [...person.aliases],
        kind: person.kind,
        contact:
          takesContact(person.kind) && person.contact !== null
            ? {
                email: person.contact.email ?? null,
                phone: person.contact.phone ?? null,
                address: person.contact.address ?? null,
              }
            : null,
        onMatter: false,
        onProceeding: false,
      };
      if (edge.proceedingId === null) entry.onMatter = true;
      else entry.onProceeding = true;
      seen.set(person.id, entry);
    }
    return { kind: group.kind, people: [...seen.values()] };
  });
}
