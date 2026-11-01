// Local scheduled reminders (#721, R15 of #64): where the browser supports Notification Triggers
// (`showTrigger` with `TimestampTrigger`), a page hands the service worker the next reminders and
// the worker schedules them on the device, so they fire with no network. Support is narrow, so
// everything is feature-detected: when unsupported nothing is scheduled and server push (ADR 0039)
// stays the only path. A local notification uses the same `tag` as the push, so the push replaces
// it instead of duplicating it. The text is as generic as the push text: no party or matter names.
export const SCHEDULE_LOCAL_REMINDERS = 'SCHEDULE_LOCAL_REMINDERS';

/** Upper bound per message, so a page cannot flood the device with scheduled notifications. */
export const MAX_LOCAL_REMINDERS = 20;

export interface LocalReminder {
  tag: string;
  title: string;
  body?: string;
  /** A same-origin path to open on tap. */
  href: string;
  /** Epoch milliseconds. */
  fireAt: number;
}

interface TriggerGlobal {
  TimestampTrigger?: new (timestamp: number) => unknown;
  Notification?: { prototype: object };
}

/** True when this runtime can schedule a notification for a future time. */
export function supportsTriggers(scope: TriggerGlobal = globalThis): boolean {
  return (
    typeof scope.TimestampTrigger === 'function' &&
    scope.Notification !== undefined &&
    'showTrigger' in scope.Notification.prototype
  );
}

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

/** The valid reminders of an untrusted message payload; anything malformed is dropped. */
export function parseReminders(input: unknown): LocalReminder[] {
  if (!Array.isArray(input)) return [];
  const out: LocalReminder[] = [];
  for (const item of input.slice(0, MAX_LOCAL_REMINDERS) as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.tag !== 'string' ||
      r.tag === '' ||
      typeof r.title !== 'string' ||
      r.title === '' ||
      !isPath(r.href) ||
      typeof r.fireAt !== 'number' ||
      !Number.isFinite(r.fireAt)
    ) {
      continue;
    }
    out.push({
      tag: r.tag,
      title: r.title,
      ...(typeof r.body === 'string' && r.body ? { body: r.body } : {}),
      href: r.href,
      fireAt: r.fireAt,
    });
  }
  return out;
}

interface RegistrationLike {
  showNotification(title: string, options?: Record<string, unknown>): Promise<void>;
  getNotifications(filter?: {
    tag?: string;
    includeTriggered?: boolean;
  }): Promise<readonly { close(): void }[]>;
}

/**
 * Schedules each future reminder, first closing a pending one with the same tag so a reschedule
 * replaces it. Resolves to how many were scheduled; 0 when unsupported (push is unchanged).
 */
export async function scheduleLocalReminders(
  registration: RegistrationLike,
  reminders: readonly LocalReminder[],
  now: number = Date.now(),
  scope: TriggerGlobal = globalThis,
): Promise<number> {
  if (!supportsTriggers(scope) || !scope.TimestampTrigger) return 0;
  const Trigger = scope.TimestampTrigger;
  let scheduled = 0;
  for (const reminder of reminders) {
    const pending = await registration.getNotifications({
      tag: reminder.tag,
      includeTriggered: true,
    });
    for (const notification of pending) notification.close();
    if (reminder.fireAt <= now) continue;
    await registration.showNotification(reminder.title, {
      tag: reminder.tag,
      ...(reminder.body ? { body: reminder.body } : {}),
      data: { href: reminder.href },
      showTrigger: new Trigger(reminder.fireAt),
    });
    scheduled += 1;
  }
  return scheduled;
}
