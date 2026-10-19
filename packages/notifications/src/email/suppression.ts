// Bounce and complaint handling (stub until the SES -> SNS wiring lands with #110): a permanent
// bounce or a complaint puts the address on `email_suppression`, which delivery checks (#196)
// before sending. The table is global (per address, no workspace), so this uses the plain handle.
import { schema, type Queryable } from '@causedeck/db';
import { sql } from 'drizzle-orm';

const { emailSuppression } = schema;

export type SuppressionReason = 'bounce' | 'complaint' | 'manual';

export async function recordSuppression(
  db: Queryable,
  entry: { email: string; reason: SuppressionReason; detail?: string | undefined },
): Promise<void> {
  await db
    .insert(emailSuppression)
    .values({ email: entry.email, reason: entry.reason, detail: entry.detail ?? null })
    .onConflictDoNothing({ target: emailSuppression.email });
}

export async function isSuppressed(db: Queryable, email: string): Promise<boolean> {
  const rows = await db
    .select({ email: emailSuppression.email })
    .from(emailSuppression)
    .where(sql`${emailSuppression.email} = ${email}`)
    .limit(1);
  return rows.length > 0;
}

/** The parts of an SES event notification (via SNS) this stub reads. */
export interface SesEvent {
  eventType?: string;
  notificationType?: string;
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: readonly { emailAddress: string; diagnosticCode?: string }[];
  };
  complaint?: {
    complaintFeedbackType?: string;
    complainedRecipients?: readonly { emailAddress: string }[];
  };
}

/**
 * Suppress the recipients of a permanent bounce or a complaint; transient bounces and every other
 * event are ignored. Returns the suppressed addresses.
 */
export async function handleSesEvent(db: Queryable, event: SesEvent): Promise<string[]> {
  const type = event.eventType ?? event.notificationType;
  const suppressed: string[] = [];
  if (type === 'Bounce' && event.bounce?.bounceType === 'Permanent') {
    for (const recipient of event.bounce.bouncedRecipients ?? []) {
      await recordSuppression(db, {
        email: recipient.emailAddress,
        reason: 'bounce',
        detail: recipient.diagnosticCode ?? event.bounce.bounceSubType,
      });
      suppressed.push(recipient.emailAddress);
    }
  }
  if (type === 'Complaint') {
    for (const recipient of event.complaint?.complainedRecipients ?? []) {
      await recordSuppression(db, {
        email: recipient.emailAddress,
        reason: 'complaint',
        detail: event.complaint?.complaintFeedbackType,
      });
      suppressed.push(recipient.emailAddress);
    }
  }
  return suppressed;
}
