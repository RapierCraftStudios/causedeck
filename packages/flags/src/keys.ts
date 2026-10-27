// The typed flag registry (#22, docs/engineering/flags.md). Every flag defaults to off; legal-gated
// (⚖) flags additionally need a staff action with a `legal_ack` note before any row can turn them
// on. Client-safe: types and static data only, no database or env access.

export interface FlagDefinition<K extends string = string> {
  key: K;
  description: string;
  /** Every flag ships dark: the registry default is always `false`. */
  default: false;
  /** ⚖ Needs counsel sign-off; enabling records `legal_ack_by` and a note (ADR 0010). */
  legalGated: boolean;
  /** Issues that consume the flag. */
  owner: readonly number[];
  /** `KILL_<KEY>`: set to a true value to force the flag off without a database read. */
  killSwitchEnv: string;
}

/** `KILL_` + the key upper-cased, every non-alphanumeric as `_` (`invoices.enabled` → `KILL_INVOICES_ENABLED`). */
export function killSwitchEnvFor(key: string): string {
  return `KILL_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function flag<const K extends string>(
  key: K,
  description: string,
  legalGated: boolean,
  owner: readonly number[],
): FlagDefinition<K> {
  return {
    key,
    description,
    default: false,
    legalGated,
    owner,
    killSwitchEnv: killSwitchEnvFor(key),
  };
}

export const FLAGS = {
  'invoices.enabled': flag(
    'invoices.enabled',
    'Fees, GST/RCM invoices and client-expense ledger.',
    true,
    [83, 120],
  ),
  'limitation.enabled': flag(
    'limitation.enabled',
    'Limitation tracker driven by counsel rule tables.',
    true,
    [84, 120],
  ),
  'court.a2.retrieval': flag(
    'court.a2.retrieval',
    'A2 user-triggered retrieval from court sites.',
    true,
    [35, 120],
  ),
  'court.live-tracking': flag(
    'court.live-tracking',
    'Live cause-list item tracking.',
    true,
    [35, 120, 493],
  ),
  'court.khc-a2': flag(
    'court.khc-a2',
    'Karnataka HC public cause-list watch through the governed fetch layer (A2).',
    true,
    [482, 118],
  ),
  'court.case-status': flag(
    'court.case-status',
    'Case-status watch and refresh.',
    true,
    [483, 118],
  ),
  'court.sanctioned-push': flag(
    'court.sanctioned-push',
    'Sanctioned push ingestion from courts.',
    true,
    [35, 120],
  ),
  'ai.bedrock': flag(
    'ai.bedrock',
    'AWS Bedrock (India) as an AI gateway provider.',
    false,
    [44, 112],
  ),
  'ai.sarvam': flag('ai.sarvam', 'Sarvam Indic STT and OCR provider.', false, [44, 51, 113]),
  'capture.whatsapp-import': flag(
    'capture.whatsapp-import',
    'WhatsApp chat-export importer.',
    true,
    [55],
  ),
  'capture.email-forward': flag(
    'capture.email-forward',
    'Email forward-in intake.',
    false,
    [54, 287],
  ),
  'capture.ics-feed': flag('capture.ics-feed', 'Private ICS calendar feed.', false, [53, 287]),
  'pwa.offline': flag('pwa.offline', 'Offline outbox and 7-day offline cache.', false, [50, 65]),
  'billing.razorpay': flag(
    'billing.razorpay',
    'Razorpay subscriptions and UPI Autopay.',
    false,
    [28, 111],
  ),
  'insights.enabled': flag('insights.enabled', 'Practice insights dashboard.', false, [85]),
  m5_playbooks: flag(
    'm5_playbooks',
    "M5 playbooks and the precedent bank (confirmed passages from the lawyer's own drafts).",
    false,
    [81, 901],
  ),
  'workspace.export': flag(
    'workspace.export',
    'Workspace data export (ZIP) from settings.',
    false,
    [31, 288],
  ),
  'conflicts.check': flag(
    'conflicts.check',
    'Conflict-of-interest check on new-matter intake (counsel sign-off required).',
    true,
    [500, 486],
  ),
  bench_facts: flag(
    'bench_facts',
    "User-facing factual bench facts (a matter's bench card); internal bench data is never behind this flag (D-050).",
    true,
    [521, 118],
  ),
} as const;

/** A registered flag key. Anything else is a compile error. */
export type FlagKey = keyof typeof FLAGS;

export const FLAG_KEYS: readonly FlagKey[] = Object.keys(FLAGS) as FlagKey[];

/** Server-evaluated flag values: the only flag data that ever reaches a client. */
export type FlagSnapshot = Readonly<Record<FlagKey, boolean>>;

export class UnknownFlagError extends Error {
  readonly code = 'UNKNOWN_FLAG' as const;

  constructor(key: string) {
    super(`Unknown feature flag: ${key}`);
    this.name = 'UnknownFlagError';
  }
}

export function isFlagKey(key: unknown): key is FlagKey {
  return typeof key === 'string' && Object.hasOwn(FLAGS, key);
}

/** The registry entry for `key`; throws `UnknownFlagError` for a key that is not registered. */
export function getFlag(key: FlagKey): FlagDefinition<FlagKey> {
  if (!isFlagKey(key)) throw new UnknownFlagError(String(key));
  return FLAGS[key];
}

/** Every flag off: the registry defaults. */
export function defaultSnapshot(): FlagSnapshot {
  return Object.fromEntries(FLAG_KEYS.map((key) => [key, FLAGS[key].default])) as FlagSnapshot;
}
