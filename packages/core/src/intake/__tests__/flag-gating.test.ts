import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  acceptEnquiry,
  closeEnquiry,
  getEnquiry,
  listEnquiries,
  logEnquiry,
  updateEnquiry,
} from '../enquiry.ts';
import { runConflictCheck } from '../conflict.ts';
import { FeatureDisabledError } from '../errors.ts';
import { chamber, deps, ENQUIRY } from './helpers.ts';

const ID = '11111111-1111-4111-8111-111111111111';

describe('intake.enquiry_log flag', () => {
  it('rejects every service with FeatureDisabledError while off, writing nothing', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const off = deps(tx, { flagEnabled: () => Promise.resolve(false) });
      const calls = [
        () => logEnquiry(off, c.owner, ENQUIRY),
        () => updateEnquiry(off, c.owner, { enquiryId: ID }),
        () => closeEnquiry(off, c.owner, { enquiryId: ID }),
        () => acceptEnquiry(off, c.owner, { enquiryId: ID }),
        () => runConflictCheck(off, c.owner, { enquiryId: ID }),
        () => getEnquiry(off, c.owner, { enquiryId: ID }),
        () => listEnquiries(off, c.owner),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toBeInstanceOf(FeatureDisabledError);
      }
      expect(await listEnquiries(deps(tx), c.owner)).toEqual([]);
    });
  });

  it('is off by default on a fresh database (legal-gated)', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await expect(logEnquiry({ db: tx }, c.owner, ENQUIRY)).rejects.toBeInstanceOf(
        FeatureDisabledError,
      );
    });
  });
});
