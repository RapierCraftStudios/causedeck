// Alert routing (#515, D-049): the open and resolve notices go to every configured channel (Slack,
// email, or the log when neither is configured), naming the on-call staff member and the runbook.
// Channels are injected ports; the Slack POST is `postWebhook` in `@causedeck/fetch`, the only
// package allowed to call an external host. A notice is sent once: `notifiedAt` is only set after
// at least one channel took it.
import type { DataOpsAlertType } from './detectors.ts';

/** What a channel is told; no fetched content, only ids, numbers and the runbook link. */
export interface AlertMessage {
  id: string;
  type: DataOpsAlertType;
  sourceId: string;
  detail: string;
  runbookUrl: string;
  /** Address of the staff member on call when the alert opened, if a rotation row covered it. */
  oncallEmail: string | null;
}

export interface AlertChannel {
  readonly name: string;
  send(event: 'opened' | 'resolved', message: AlertMessage): Promise<void>;
}

export interface AlertNotifier {
  opened(message: AlertMessage): Promise<void>;
  resolved(message: AlertMessage): Promise<void>;
}

/** The one-line text every channel sends. */
export function formatAlert(event: 'opened' | 'resolved', m: AlertMessage): string {
  const head = event === 'opened' ? 'ALERT' : 'RESOLVED';
  const oncall = m.oncallEmail === null ? '' : ` On call: ${m.oncallEmail}.`;
  return `[${head}] ${m.type} on ${m.sourceId}: ${m.detail}.${oncall} Runbook: ${m.runbookUrl}`;
}

/** Slack incoming webhook; `post` is `postWebhook` bound to the configured URL. */
export function createSlackChannel(
  post: (payload: { text: string }) => Promise<void>,
): AlertChannel {
  return {
    name: 'slack',
    send: (event, message) => post({ text: formatAlert(event, message) }),
  };
}

export interface AlertEmail {
  to: string;
  subject: string;
  text: string;
}

/** Email to the alert mailbox and the on-call address; sends nothing when neither exists. */
export function createEmailChannel(
  send: (email: AlertEmail) => Promise<void>,
  alertAddress: string | undefined,
): AlertChannel {
  return {
    name: 'email',
    async send(event, message) {
      const to = [...new Set([alertAddress, message.oncallEmail ?? undefined])].filter(
        (address): address is string => address !== undefined && address !== '',
      );
      const subject = `[${event === 'opened' ? 'ALERT' : 'RESOLVED'}] ${message.type} on ${message.sourceId}`;
      for (const address of to) {
        await send({ to: address, subject, text: formatAlert(event, message) });
      }
    },
  };
}

/** Logs the notice; the fallback when no Slack webhook or alert mailbox is configured. */
export function createLogChannel(log: { warn(obj: object, msg: string): void }): AlertChannel {
  return {
    name: 'log',
    send(event, message) {
      log.warn(
        { event, type: message.type, sourceId: message.sourceId, runbook: message.runbookUrl },
        formatAlert(event, message),
      );
      return Promise.resolve();
    },
  };
}

/** Fan a notice out to every channel. It succeeds when any channel took it, and throws when all failed. */
export function createAlertRouter(channels: readonly AlertChannel[]): AlertNotifier {
  async function fanOut(event: 'opened' | 'resolved', message: AlertMessage): Promise<void> {
    if (channels.length === 0) return;
    const results = await Promise.allSettled(channels.map((c) => c.send(event, message)));
    if (results.every((r) => r.status === 'rejected')) {
      throw new Error(
        `Alert ${event} reached no channel (${channels.map((c) => c.name).join(', ')})`,
      );
    }
  }
  return {
    opened: (message) => fanOut('opened', message),
    resolved: (message) => fanOut('resolved', message),
  };
}
