// `next_date` (#47): stage the proposed date with `proposeNextDate` at submit time (a proposal, or a
// conflict card that keeps both sources, or nothing to do), and confirm it with `confirmNextDate`
// only once a person has accepted. The engine never applies this kind at any level, so a confirmed
// next date is never overwritten without an explicit acceptance (ADR 0016, issue #47).
import { z } from 'zod';

import {
  confirmNextDate,
  getCanonicalNextDate,
  proposeNextDate,
} from '../../matter-graph/index.ts';
import { conflict } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { day, parsePayload, uuid } from './common.ts';

const Payload = z.strictObject({
  proceedingId: uuid,
  date: day,
  listType: z.enum(['daily', 'advance', 'supplementary', 'special']).optional(),
  stageRaw: z.string().optional(),
  listNo: z.int().positive().nullable().optional(),
  itemNo: z.string().trim().min(1).nullable().optional(),
});
type Payload = z.output<typeof Payload>;

export const nextDateHandler: ProposalHandler<Payload> = {
  kind: 'next_date',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async stage(scope, payload, provenance) {
    const result = await proposeNextDate(scope.deps, scope.actor, {
      ...payload,
      provenance: { ...provenance, confirmationState: 'proposed' },
    });
    if (result.kind === 'noop') {
      return { entityRefs: {}, supersede: 'Already the confirmed next date' };
    }
    if (result.kind === 'proposal') {
      return {
        entityRefs: { listingId: result.listingId, date: payload.date, conflict: false },
      };
    }
    return {
      entityRefs: {
        listingId: result.proposed.id,
        date: payload.date,
        currentListingId: result.current.id,
        conflict: true,
      },
    };
  },

  async apply(scope, ctx) {
    let listingId = ctx.entityRefs['listingId'];
    // An edit that changed the date no longer matches what was staged: stage the edited date.
    if (typeof listingId !== 'string' || ctx.entityRefs['date'] !== ctx.payload.date) {
      const staged = await proposeNextDate(scope.deps, scope.actor, {
        ...ctx.payload,
        provenance: { ...ctx.provenance, confirmationState: 'proposed' },
      });
      if (staged.kind === 'noop') throw conflict('That is already the confirmed next date');
      listingId = staged.kind === 'proposal' ? staged.listingId : staged.proposed.id;
    }
    if (typeof listingId !== 'string') throw conflict('The proposed date was not staged');
    const previous = await getCanonicalNextDate(scope.deps, scope.actor, {
      proceedingId: ctx.payload.proceedingId,
    });
    const row = await confirmNextDate(scope.deps, scope.actor, { listingId });
    return {
      undoPayload: { listingId: row.id, previousListingId: previous?.id ?? null },
      entityRefs: { listingId: row.id, proceedingId: ctx.payload.proceedingId },
      summary: 'Confirmed the next date',
      proceedingId: ctx.payload.proceedingId,
    };
  },

  async undo(scope, activity) {
    const previous = activity.undoPayload?.['previousListingId'];
    if (typeof previous !== 'string') {
      throw conflict('There was no earlier next date to go back to');
    }
    await confirmNextDate(scope.deps, scope.actor, { listingId: previous, allowPast: true });
  },
};
