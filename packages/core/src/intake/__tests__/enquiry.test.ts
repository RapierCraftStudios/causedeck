import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  acceptEnquiry,
  closeEnquiry,
  getEnquiry,
  listEnquiries,
  logEnquiry,
  updateEnquiry,
} from '../enquiry.ts';
import { runConflictCheck } from '../conflict.ts';
import { chamber, deps, ENQUIRY } from './helpers.ts';

describe('enquiry log (#87)', () => {
  it('logs with parties, updates, and closes; audit holds no names', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const logged = await logEnquiry(d, c.advocate, ENQUIRY);
      expect(logged).toMatchObject({ status: 'logged', channel: 'phone' });
      expect(logged.parties).toHaveLength(2);
      const updated = await updateEnquiry(d, c.advocate, {
        enquiryId: logged.id,
        phone: '+919876543210',
        status: 'referred',
      });
      expect(updated).toMatchObject({ status: 'referred', phone: '+919876543210' });
      const closed = await closeEnquiry(d, c.owner, {
        enquiryId: logged.id,
        reason: 'referred out',
      });
      expect(closed.status).toBe('closed');
      expect(closed.closedAt).toEqual(new Date('2026-11-02T10:00:00Z'));
      await expect(closeEnquiry(d, c.owner, { enquiryId: logged.id })).rejects.toThrow(
        /already closed/,
      );
      await expect(
        updateEnquiry(d, c.owner, { enquiryId: logged.id, summary: 'x' }),
      ).rejects.toThrow(/no longer/);
      const events = await inWorkspace(tx, c.workspaceId, (s) =>
        s.select().from(schema.auditEvent),
      );
      const mine = events.filter((e) => e.action.startsWith('enquiry.'));
      expect(mine.map((e) => e.action).sort()).toEqual([
        'enquiry.closed',
        'enquiry.logged',
        'enquiry.updated',
      ]);
      expect(JSON.stringify(mine.map((e) => e.metadata))).not.toMatch(/Rao|Meena|Tenancy/);
    });
  });

  it('changing parties after a check asks for a new check', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const { id } = await logEnquiry(d, c.advocate, ENQUIRY);
      await runConflictCheck(d, c.advocate, { enquiryId: id });
      expect((await getEnquiry(d, c.advocate, { enquiryId: id })).status).toBe('checked');
      const after = await updateEnquiry(d, c.advocate, {
        enquiryId: id,
        parties: [{ name: 'Other Co', side: 'adverse' }],
      });
      expect(after.status).toBe('logged');
    });
  });

  it('accepts only after a check, and only through a new_matter proposal', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const { id } = await logEnquiry(d, c.advocate, ENQUIRY);
      await expect(acceptEnquiry(d, c.advocate, { enquiryId: id })).rejects.toThrow(
        /conflict check/,
      );
      await runConflictCheck(d, c.advocate, { enquiryId: id });
      const accepted = await acceptEnquiry(d, c.advocate, { enquiryId: id, title: 'Rao v. Meena' });
      expect(accepted.status).toBe('accepted_as_matter');
      expect(accepted.proposalId).not.toBeNull();
      const proposals = await inWorkspace(tx, c.workspaceId, (s) =>
        s.select().from(schema.proposal),
      );
      expect(proposals.map((p) => [p.id, p.kind])).toEqual([[accepted.proposalId, 'new_matter']]);
      const matters = await inWorkspace(tx, c.workspaceId, (s) => s.select().from(schema.matter));
      expect(matters).toEqual([]);
      await expect(
        updateEnquiry(d, c.advocate, { enquiryId: id, status: 'accepted_as_matter' }),
      ).rejects.toThrow();
    });
  });

  it('denies clerk, junior and viewer every service', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const d = deps(tx);
      const { id } = await logEnquiry(d, c.owner, ENQUIRY);
      for (const who of [c.clerk, c.junior, c.viewer]) {
        await expect(logEnquiry(d, who, ENQUIRY)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(listEnquiries(d, who)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(getEnquiry(d, who, { enquiryId: id })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(updateEnquiry(d, who, { enquiryId: id, summary: 'x' })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(closeEnquiry(d, who, { enquiryId: id })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(runConflictCheck(d, who, { enquiryId: id })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(acceptEnquiry(d, who, { enquiryId: id })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      }
      expect(await listEnquiries(d, c.advocate)).toHaveLength(1);
    });
  });

  it('is invisible across workspaces: B on A is denied and A is unchanged', async () => {
    await withTestDb(async (tx) => {
      const a = await chamber(tx);
      const b = await newWorkspace(tx);
      const d = deps(tx);
      const { id } = await logEnquiry(d, a.owner, ENQUIRY);
      const asB = { userId: b.ownerId, workspaceId: b.workspaceId };
      const asBClaimingA = { userId: b.ownerId, workspaceId: a.workspaceId };
      for (const who of [asBClaimingA]) {
        await expect(getEnquiry(d, who, { enquiryId: id })).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
        await expect(logEnquiry(d, who, ENQUIRY)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      await expect(getEnquiry(d, asB, { enquiryId: id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(closeEnquiry(d, asB, { enquiryId: id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await listEnquiries(d, asB)).toEqual([]);
      expect((await getEnquiry(d, a.owner, { enquiryId: id })).status).toBe('logged');
    });
  });
});
