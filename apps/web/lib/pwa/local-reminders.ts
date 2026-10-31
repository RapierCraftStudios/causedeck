// Page side of local scheduled reminders (#721): posts the next reminders to the ready service
// worker, which schedules them where the browser supports it (`sw/local-reminders.ts`). A no-op
// without a service worker, so push stays the fallback. No caller exists yet: it needs a source of
// upcoming reminder times, which the reminder jobs do not expose to the page today.
import { SCHEDULE_LOCAL_REMINDERS, type LocalReminder } from '../../sw/local-reminders.ts';

/** Returns true when the message was handed to a worker. */
export async function postLocalReminders(reminders: readonly LocalReminder[]): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) return false;
    worker.postMessage({ type: SCHEDULE_LOCAL_REMINDERS, reminders });
    return true;
  } catch {
    return false;
  }
}
