// Staff-only flag writes and their audit events, contract-tested with a fake sink (#22; writer #26).
import { withTestDb } from '@causedeck/db/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  asStaff,
  FlagAdminError,
  isStaffActor,
  setFlag,
  setWorkspaceFlag,
  type StaffActor,
} from '../admin.ts';
import { flagAuditSink, setFlagAuditSink, type FlagAuditEvent } from '../audit.ts';

import { seed } from './helpers.ts';

function fakeSink() {
  const events: FlagAuditEvent[] = [];
  return {
    events,
    sink: { write: (_tx: unknown, e: FlagAuditEvent) => (events.push(e), Promise.resolve()) },
  };
}

afterEach(() => {
  setFlagAuditSink(null);
});

describe('flag admin', () => {
  it('only accepts a staff actor', async () => {
    await withTestDb(async (tx) => {
      const { ua } = await seed(tx);
      const notStaff = { userId: ua } as unknown as StaffActor;
      expect(isStaffActor(notStaff)).toBe(false);
      expect(isStaffActor(asStaff(ua))).toBe(true);
      await expect(setFlag(tx, notStaff, { key: 'pwa.offline', enabled: true })).rejects.toThrow(
        FlagAdminError,
      );
      await expect(
        setFlag(tx, notStaff, { key: 'pwa.offline', enabled: true }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(() => asStaff('not-a-uuid')).toThrow(TypeError);
    });
  });

  it('records actor, key, workspace, old and new value through the audit sink', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seed(tx);
      const { events, sink } = fakeSink();
      setFlagAuditSink(sink);
      const staff = asStaff(ua);

      await setFlag(tx, staff, { key: 'pwa.offline', enabled: true });
      await setFlag(tx, staff, { key: 'pwa.offline', enabled: false });
      await setWorkspaceFlag(tx, staff, { workspaceId: a.id, key: 'pwa.offline', enabled: true });
      await setFlag(tx, staff, {
        key: 'limitation.enabled',
        enabled: true,
        legalAckNote: 'Counsel rule tables #120',
      });

      expect(events).toEqual([
        expect.objectContaining({
          action: 'flag.changed',
          actorUserId: ua,
          key: 'pwa.offline',
          workspaceId: null,
          oldValue: null,
          newValue: true,
        }),
        expect.objectContaining({
          actorUserId: ua,
          key: 'pwa.offline',
          workspaceId: null,
          oldValue: true,
          newValue: false,
        }),
        expect.objectContaining({
          actorUserId: ua,
          key: 'pwa.offline',
          workspaceId: a.id,
          oldValue: null,
          newValue: true,
        }),
        expect.objectContaining({
          key: 'limitation.enabled',
          oldValue: null,
          newValue: true,
          legalAckNote: 'Counsel rule tables #120',
        }),
      ]);
      for (const event of events) expect(event.at).toBeInstanceOf(Date);
    });
  });

  it('writes nothing to the sink when the change is rejected', async () => {
    await withTestDb(async (tx) => {
      const { ua } = await seed(tx);
      const { events, sink } = fakeSink();
      await expect(
        setFlag(tx, asStaff(ua), { key: 'court.a2.retrieval', enabled: true }, { audit: sink }),
      ).rejects.toThrow(/legal_ack/);
      expect(events).toEqual([]);
      expect(flagAuditSink).toBeDefined();
    });
  });
});
