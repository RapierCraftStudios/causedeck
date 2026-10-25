import { schema } from '@causedeck/db';
import { testAppDb } from '@causedeck/db/testing';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { handleSesEvent, isSuppressed, recordSuppression } from '../suppression.ts';

const db = testAppDb();
const address = (label: string) => `${label}-${randomUUID()}@example.in`;

async function rows(email: string) {
  return db.select().from(schema.emailSuppression).where(eq(schema.emailSuppression.email, email));
}

describe('email suppression (bounce/complaint stub)', () => {
  it('suppresses the recipients of a permanent bounce', async () => {
    const email = address('bounce');
    const suppressed = await handleSesEvent(db, {
      eventType: 'Bounce',
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [{ emailAddress: email, diagnosticCode: 'smtp; 550 5.1.1 unknown' }],
      },
    });
    expect(suppressed).toEqual([email]);
    const [row] = await rows(email);
    expect(row?.reason).toBe('bounce');
    expect(row?.detail).toBe('smtp; 550 5.1.1 unknown');
  });

  it('suppresses complainers', async () => {
    const email = address('complaint');
    await handleSesEvent(db, {
      notificationType: 'Complaint',
      complaint: {
        complaintFeedbackType: 'abuse',
        complainedRecipients: [{ emailAddress: email }],
      },
    });
    const [row] = await rows(email);
    expect(row?.reason).toBe('complaint');
  });

  it('ignores transient bounces and other events', async () => {
    const email = address('transient');
    const suppressed = await handleSesEvent(db, {
      eventType: 'Bounce',
      bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: email }] },
    });
    await handleSesEvent(db, { eventType: 'Delivery' });
    expect(suppressed).toEqual([]);
    expect(await rows(email)).toHaveLength(0);
    expect(await isSuppressed(db, email)).toBe(false);
  });

  it('is idempotent and case-insensitive', async () => {
    const email = address('repeat');
    await recordSuppression(db, { email, reason: 'bounce' });
    await recordSuppression(db, { email: email.toUpperCase(), reason: 'complaint' });
    expect(await rows(email)).toHaveLength(1);
    expect(await isSuppressed(db, email.toUpperCase())).toBe(true);
  });
});
