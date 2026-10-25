// `party_detail` (#47): a person (party, client, professional) or a contact detail for one. A new
// person is a proposal; a phone or email on a known party may be added unasked. Written through
// `upsertPerson`. Undo restores the person as it was, or deletes a person this created.
import { schema } from '@causedeck/db';
import { PERSON_KINDS } from '@causedeck/validators/matter-graph';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { upsertPerson } from '../../matter-graph/index.ts';
import { conflict, invalid, notFound } from '../../shared/errors.ts';
import type { HandlerProvenance, ProposalHandler } from '../types.ts';

import { parsePayload, pgCode, uuid } from './common.ts';

const Contact = z
  .strictObject({
    email: z.email().max(320).exactOptional(),
    phone: z.string().trim().min(1).max(40).exactOptional(),
    address: z.string().trim().min(1).max(500).exactOptional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'Give at least one contact detail');

const Payload = z.strictObject({
  /** A known person to add details to; absent for a new person. */
  personId: uuid.optional(),
  name: z.string().trim().min(1).max(300).optional(),
  kind: z.enum(PERSON_KINDS).optional(),
  aliases: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  contact: Contact.optional(),
});
type Payload = z.output<typeof Payload>;

interface PersonBefore {
  name: string;
  kind: (typeof PERSON_KINDS)[number];
  aliases: string[];
  contact: Record<string, string> | null;
  /** The provenance the person had before: an undo puts it back with the details. */
  provenance: HandlerProvenance;
}

export const partyDetailHandler: ProposalHandler<Payload> = {
  kind: 'party_detail',
  enabled: true,
  validate: (payload) => {
    const parsed = parsePayload(Payload, payload);
    if (parsed.personId === undefined && (parsed.name === undefined || parsed.kind === undefined)) {
      throw invalid('name and kind are required for a new person');
    }
    return parsed;
  },

  async apply(scope, ctx) {
    const { person } = schema;
    const { workspaceId } = scope.actor;
    const p = ctx.payload;
    let before: PersonBefore | null = null;
    if (p.personId !== undefined) {
      const [current] = await scope.tx
        .select()
        .from(person)
        .where(and(eq(person.workspaceId, workspaceId), eq(person.id, p.personId)))
        .limit(1);
      if (current === undefined) throw notFound('Person not found');
      before = {
        name: current.name,
        kind: current.kind,
        aliases: current.aliases,
        contact: current.contact as Record<string, string> | null,
        provenance: {
          sourceType: current.sourceType,
          sourceRef: current.sourceRef,
          anchorId: current.anchorId,
          confidence: current.confidence,
          confirmationState: current.confirmationState,
        },
      };
    }
    const name = p.name ?? before?.name;
    const kind = p.kind ?? before?.kind;
    if (name === undefined || kind === undefined) throw conflict('name and kind are required');
    const row = await upsertPerson(scope.deps, scope.actor, {
      ...(p.personId === undefined ? {} : { personId: p.personId }),
      name,
      kind,
      ...(p.aliases === undefined ? {} : { aliases: p.aliases }),
      ...(p.contact === undefined ? {} : { contact: { ...before?.contact, ...p.contact } }),
      provenance: ctx.provenance,
    });
    return {
      undoPayload: { personId: row.id, created: before === null, before },
      entityRefs: { personIds: [row.id] },
      summary: before === null ? 'Added a person' : 'Added details to a person',
    };
  },

  async undo(scope, activity) {
    const { person } = schema;
    const payload = activity.undoPayload as {
      personId?: string;
      created?: boolean;
      before?: PersonBefore | null;
    } | null;
    if (payload?.personId === undefined) throw conflict('The person id is missing');
    const { personId } = payload;
    if (payload.created === true || payload.before == null) {
      try {
        await scope.tx.transaction((sp) =>
          sp
            .delete(person)
            .where(and(eq(person.workspaceId, activity.workspaceId), eq(person.id, personId))),
        );
      } catch (error) {
        if (pgCode(error) === '23503') {
          throw conflict('The person has roles on a matter now; remove them first');
        }
        throw error;
      }
      return;
    }
    await upsertPerson(scope.deps, scope.actor, {
      personId,
      name: payload.before.name,
      kind: payload.before.kind,
      aliases: payload.before.aliases,
      contact: payload.before.contact,
      provenance: payload.before.provenance,
    });
  },
};
