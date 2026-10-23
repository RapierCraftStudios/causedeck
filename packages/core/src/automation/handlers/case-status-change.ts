// `case_status_change` (#591): a next hearing date read from a watched court status page. It is
// handled exactly like `next_date`: stage the date with `proposeNextDate` at submit time and confirm
// it with `confirmNextDate` only once a person has accepted, so a confirmed next date is never
// overwritten unasked. Stage and bench are context for the card and are not written.
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
  watchId: uuid,
  snapshotId: uuid,
  nextHearingDate: day,
  stageRaw: z.string().optional(),
  bench: z.string().optional(),
});
type Payload = z.output<typeof Payload>;

export const caseStatusChangeHandler: ProposalHandler<Payload> = {
  kind: 'case_status_change',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async stage(scope, payload, provenance) {
    const result = await proposeNextDate(scope.deps, scope.actor, {
      proceedingId: payload.proceedingId,
      date: payload.nextHearingDate,
      ...(payload.stageRaw === undefined ? {} : { stageRaw: payload.stageRaw }),
      provenance: { ...provenance, confirmationState: 'proposed' },
    });
    if (result.kind === 'noop') {
      return { entityRefs: {}, supersede: 'Already the confirmed next date' };
    }
    if (result.kind === 'proposal') {
      return {
        entityRefs: {
          listingId: result.listingId,
          date: payload.nextHearingDate,
          conflict: false,
        },
      };
    }
    return {
      entityRefs: {
        listingId: result.proposed.listingId,
        date: payload.nextHearingDate,
        currentListingId: result.current.listingId,
        conflict: true,
      },
    };
  },

  async apply(scope, ctx) {
    let listingId = ctx.entityRefs['listingId'];
    if (typeof listingId !== 'string' || ctx.entityRefs['date'] !== ctx.payload.nextHearingDate) {
      const staged = await proposeNextDate(scope.deps, scope.actor, {
        proceedingId: ctx.payload.proceedingId,
        date: ctx.payload.nextHearingDate,
        provenance: { ...ctx.provenance, confirmationState: 'proposed' },
      });
      if (staged.kind === 'noop') throw conflict('That is already the confirmed next date');
      listingId = staged.kind === 'proposal' ? staged.listingId : staged.proposed.listingId;
    }
    if (typeof listingId !== 'string') throw conflict('The proposed date was not staged');
    const previous = await getCanonicalNextDate(scope.deps, scope.actor, {
      proceedingId: ctx.payload.proceedingId,
    });
    const row = await confirmNextDate(scope.deps, scope.actor, { listingId });
    return {
      undoPayload: { listingId: row.id, previousListingId: previous?.id ?? null },
      entityRefs: { listingId: row.id, proceedingId: ctx.payload.proceedingId },
      summary: 'Confirmed the next date from the court status page',
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
