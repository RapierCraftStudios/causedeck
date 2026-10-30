// One client contact with what its detail page shows (#82, part 2): the matters its client is linked
// to and the read-only log of changes made to its details. The contact itself comes from
// `listContacts`, so its visibility rules (a junior's assigned matters, a clerk's redaction, the
// workspace boundary) apply unchanged; another workspace's contact is NOT_FOUND. The linked matters
// are limited to those the actor may read. The log (`contact_detail` activities, summaries only) is
// withheld from a clerk, who sees logistics only.
import { isRole } from '@causedeck/auth';
import { can } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import { isUuid, schema, withWorkspace } from '@causedeck/db';
import { ContactIdInput } from '@causedeck/validators/client-contact';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { notFound } from '../shared/errors.ts';
import { getRoleSettings, memberRole, toPolicySettings } from '../workspaces/index.ts';

import { listContacts, type ContactView, type PeopleActor, type PeopleDeps } from './contacts.ts';

const { activity, matter, member, roleEdge } = schema;

/** Newest entries of the log shown on the detail page. */
const LOG_LIMIT = 50;

export interface ContactLinkedMatter {
  matterId: string;
  title: string;
  relation: 'represents' | 'instructed_by';
}

export interface ContactLogEntry {
  id: string;
  summary: string;
  createdAt: Date;
  undone: boolean;
}

export interface ContactDetail {
  contact: ContactView;
  matters: ContactLinkedMatter[];
  log: ContactLogEntry[];
}

const matterOwnerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;

/** The contact, its readable linked matters and its change log; NOT_FOUND unless the actor sees it. */
export async function getContactDetail(
  deps: PeopleDeps,
  actor: PeopleActor,
  input: { contactId: string },
): Promise<ContactDetail> {
  const parsed = ContactIdInput.safeParse(input);
  if (!parsed.success) throw notFound('Contact not found');
  const { contactId } = parsed.data;
  const contacts = await listContacts(deps, actor, { includeArchived: true });
  const contact = contacts.find((c) => c.id === contactId);
  if (contact === undefined) throw notFound('Contact not found');
  const { workspaceId, userId } = actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) throw notFound('Contact not found');

  return withWorkspace(deps.db, { workspaceId, userId }, async (tx) => {
    const role = await memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw notFound('Contact not found');
    const reader = { ...actor, role };
    const settings = deps.settings ?? toPolicySettings(await getRoleSettings(tx, workspaceId));

    const matters: ContactLinkedMatter[] = [];
    if (can(reader, 'matter.read', undefined, settings).allow) {
      const rows = await tx
        .select({ matterId: matter.id, title: matter.title, relation: roleEdge.kind })
        .from(roleEdge)
        .innerJoin(
          matter,
          and(eq(matter.workspaceId, roleEdge.workspaceId), eq(matter.id, roleEdge.matterId)),
        )
        .where(
          and(
            eq(roleEdge.workspaceId, workspaceId),
            eq(roleEdge.fromPersonId, contact.personId),
            inArray(roleEdge.kind, ['represents', 'instructed_by']),
            isNotNull(roleEdge.matterId),
            matterVisibilityPredicate(reader, matter.id, {
              settings,
              ownerUserId: matterOwnerUserId,
            }),
          ),
        )
        .orderBy(asc(matter.title), asc(matter.id));
      for (const row of rows) {
        if (row.relation === 'represents' || row.relation === 'instructed_by') {
          matters.push({ matterId: row.matterId, title: row.title, relation: row.relation });
        }
      }
    }

    let log: ContactLogEntry[] = [];
    if (!contact.redacted) {
      const rows = await tx
        .select({
          id: activity.id,
          summary: activity.summary,
          createdAt: activity.createdAt,
          undoneAt: activity.undoneAt,
        })
        .from(activity)
        .where(
          and(
            eq(activity.workspaceId, workspaceId),
            eq(activity.kind, 'contact_detail'),
            sql`${activity.entityRefs}->>'contactId' = ${contactId}`,
          ),
        )
        .orderBy(desc(activity.createdAt), desc(activity.id))
        .limit(LOG_LIMIT);
      log = rows.map((r) => ({
        id: r.id,
        summary: r.summary,
        createdAt: r.createdAt,
        undone: r.undoneAt !== null,
      }));
    }
    return { contact, matters, log };
  });
}
