// Feature-flag kill switches (#22, docs/engineering/flags.md). One `KILL_<KEY>` per flag in the
// `@causedeck/flags` registry: the flag key upper-cased with every non-alphanumeric as `_`. Config
// cannot import the flags package, so the names are listed here and a flags test keeps the two in
// sync. Any `KILL_*` key is parsed as a boolean by the env schema; a true value forces the flag off
// without touching the database.
import type { ServerEnv } from './schema.ts';

export const FLAG_KILL_SWITCHES = [
  'KILL_INVOICES_ENABLED',
  'KILL_LIMITATION_ENABLED',
  'KILL_COURT_A2_RETRIEVAL',
  'KILL_COURT_LIVE_TRACKING',
  'KILL_COURT_KHC_A2',
  'KILL_COURT_CASE_STATUS',
  'KILL_COURT_SANCTIONED_PUSH',
  'KILL_AI_BEDROCK',
  'KILL_AI_SARVAM',
  'KILL_CAPTURE_WHATSAPP_IMPORT',
  'KILL_CAPTURE_EMAIL_FORWARD',
  'KILL_CAPTURE_ICS_FEED',
  'KILL_PWA_OFFLINE',
  'KILL_BILLING_RAZORPAY',
  'KILL_INSIGHTS_ENABLED',
  'KILL_WORKSPACE_EXPORT',
  'KILL_CONFLICTS_CHECK',
  'KILL_INTAKE_ENQUIRY_LOG',
  'KILL_STATUS_LINKS_ENABLED',
  'KILL_BENCH_FACTS',
  'KILL_M5_PLAYBOOKS',
  'KILL_GROWTH_ONBOARDING_NUDGE',
  'KILL_CAPTCHA_BULK',
] as const;

export type FlagKillSwitch = (typeof FLAG_KILL_SWITCHES)[number];

/** Whether `name` is set to a true value in `env` (the parsed `KILL_*` map). */
export function killSwitch(name: string, env: Pick<ServerEnv, 'killSwitches'>): boolean {
  // `killSwitches` is absent when validation is skipped (SKIP_ENV_VALIDATION=1).
  return (env.killSwitches as ServerEnv['killSwitches'] | undefined)?.[name] === true;
}
