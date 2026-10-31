// The gate of bulk captcha solving (#492, D-048). Nothing runs unless the source's registry row
// carries `captcha_bulk_cleared` AND an approval reference, and neither the global kill switch
// `KILL_CAPTCHA_BULK` nor the host's own switch is set. Pure: the caller injects the switches
// (this package never reads the environment).
import type { FetchPolicy } from '../types.ts';

export const KILL_CAPTCHA_BULK = 'KILL_CAPTCHA_BULK';

/** Why a bulk job was refused. */
export type BulkCaptchaDenial =
  'kill_switch' | 'host_killed' | 'not_cleared' | 'approval_ref_missing';

/** The kill switches, read fresh on every dispatch so a flip takes effect within a tick. */
export interface BulkKillSwitches {
  global(): boolean;
  host(host: string): boolean;
}

/** `KILL_CAPTCHA_BULK_HOST_<HOST>`: the host upper-cased with every non-alphanumeric as `_`. */
export function hostKillSwitchName(host: string): string {
  return `${KILL_CAPTCHA_BULK}_HOST_${host.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** Kill switches over the parsed `KILL_*` map (`env.killSwitches`); `read` is called on every check. */
export function killSwitchesFromMap(
  read: () => Readonly<Record<string, boolean>> | undefined,
): BulkKillSwitches {
  return {
    global: () => read()?.[KILL_CAPTCHA_BULK] === true,
    host: (host) => read()?.[hostKillSwitchName(host)] === true,
  };
}

/** `null` when the job may run, else the first reason it may not. */
export function bulkCaptchaGate(
  policy: Pick<FetchPolicy, 'captchaBulkCleared' | 'captchaBulkApprovalRef'>,
  host: string,
  kill: BulkKillSwitches,
): BulkCaptchaDenial | null {
  if (kill.global()) return 'kill_switch';
  if (kill.host(host)) return 'host_killed';
  if (!policy.captchaBulkCleared) return 'not_cleared';
  const ref = policy.captchaBulkApprovalRef;
  if (typeof ref !== 'string' || ref.trim() === '') return 'approval_ref_missing';
  return null;
}
