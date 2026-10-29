// Onboarding wizard schemas (#92): the steps of the solo and chamber paths and the payload each
// step accepts. Shared by the server actions in `apps/web` and the domain service in
// `@causedeck/core/onboarding`, so both reject the same values. Objects are strict.
import { z } from 'zod';

export const ONBOARDING_PATH_VALUES = ['solo', 'chamber'] as const;
export type OnboardingPath = (typeof ONBOARDING_PATH_VALUES)[number];

/** Solo (PRD UJ-1): at most seven steps from sign-in to the court-day view. */
export const SOLO_STEPS = ['workspace', 'profile', 'courts', 'import', 'confirm', 'done'] as const;
/** Chamber (PRD UJ-2): the same confirm grid follows the bulk import. */
export const CHAMBER_STEPS = [
  'workspace',
  'invite',
  'roles',
  'import',
  'confirm',
  'delegation',
  'brief-format',
  'done',
] as const;

export type SoloStep = (typeof SOLO_STEPS)[number];
export type ChamberStep = (typeof CHAMBER_STEPS)[number];
export type OnboardingStep = SoloStep | ChamberStep;

export function stepsOf(path: OnboardingPath): readonly OnboardingStep[] {
  return path === 'solo' ? SOLO_STEPS : CHAMBER_STEPS;
}

export function isOnboardingPath(value: string): value is OnboardingPath {
  return (ONBOARDING_PATH_VALUES as readonly string[]).includes(value);
}

export function isStepOf(path: OnboardingPath, value: string): value is OnboardingStep {
  return (stepsOf(path) as readonly string[]).includes(value);
}

/** The step after `step` on `path`, or `null` after the last one. */
export function nextStepOf(path: OnboardingPath, step: OnboardingStep): OnboardingStep | null {
  const steps = stepsOf(path);
  const index = steps.indexOf(step);
  return index < 0 ? null : (steps[index + 1] ?? null);
}

/** The step before `step`, or `null` at the first one. */
export function previousStepOf(path: OnboardingPath, step: OnboardingStep): OnboardingStep | null {
  const steps = stepsOf(path);
  const index = steps.indexOf(step);
  return index <= 0 ? null : (steps[index - 1] ?? null);
}

/** Steps a person may skip; everything else needs its answer. Skipping import is never a dead end. */
export const SKIPPABLE_STEPS: Readonly<Record<OnboardingPath, readonly OnboardingStep[]>> = {
  solo: ['import', 'confirm'],
  chamber: ['invite', 'import', 'confirm', 'delegation', 'brief-format'],
};

export function isSkippable(path: OnboardingPath, step: OnboardingStep): boolean {
  return SKIPPABLE_STEPS[path].includes(step);
}

/** Bar councils the profile offers; stored as the id, shown as a translated name. */
export const BAR_COUNCIL_VALUES = [
  'tamil_nadu_puducherry',
  'karnataka',
  'kerala',
  'andhra_pradesh',
  'telangana',
  'maharashtra_goa',
  'delhi',
  'other',
] as const;

export const PRACTICE_AREA_VALUES = [
  'civil',
  'criminal',
  'writ',
  'family',
  'property',
  'corporate',
  'labour_service',
  'tax',
  'consumer',
  'arbitration',
] as const;

export const WORKING_LANGUAGE_VALUES = ['en', 'ta', 'kn', 'hi', 'te', 'ml'] as const;

/** Enrolment numbers look like `MS/1234/2019`: letters, digits and the usual separators. */
export const ENROLMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 /().-]{2,39}$/;

export const ProfileStepInput = z.strictObject({
  enrolmentNumber: z.string().trim().regex(ENROLMENT_PATTERN, 'Enter your enrolment number'),
  barCouncil: z.enum(BAR_COUNCIL_VALUES),
  practiceAreas: z.array(z.enum(PRACTICE_AREA_VALUES)).min(1).max(PRACTICE_AREA_VALUES.length),
  languages: z.array(z.enum(WORKING_LANGUAGE_VALUES)).min(1).max(WORKING_LANGUAGE_VALUES.length),
});
export type ProfileStepInput = z.infer<typeof ProfileStepInput>;

/** Forum catalogue codes (`in.tn.madras-hc.principal.original`). */
export const FORUM_CODE_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export const CourtsStepInput = z.strictObject({
  forumCodes: z.array(z.string().max(120).regex(FORUM_CODE_RE)).min(1).max(12),
});
export type CourtsStepInput = z.infer<typeof CourtsStepInput>;

/** Colleagues the owner invites. The clerk role starts restricted: no strategy notes, no memory. */
export const ONBOARDING_INVITE_ROLES = ['advocate', 'junior', 'clerk'] as const;

export const InviteRow = z.strictObject({
  email: z.email().transform((value) => value.toLowerCase()),
  role: z.enum(ONBOARDING_INVITE_ROLES),
});
export const InviteStepInput = z.strictObject({
  invites: z.array(InviteRow).min(1).max(20),
});
export type InviteStepInput = z.infer<typeof InviteStepInput>;

export const DELEGATION_CAPACITY_DEFAULTS = ['arguing', 'assisting', 'proxy'] as const;

/** Delegation defaults a chamber starts with; saved to `workspace_settings.delegation_defaults`. */
export const DelegationDefaults = z.strictObject({
  suggestAssignments: z.boolean(),
  defaultCapacity: z.enum(DELEGATION_CAPACITY_DEFAULTS),
  notifyAssignee: z.boolean(),
});
export type DelegationDefaults = z.infer<typeof DelegationDefaults>;

export const DEFAULT_DELEGATION_DEFAULTS: DelegationDefaults = {
  suggestAssignments: true,
  defaultCapacity: 'assisting',
  notifyAssignee: true,
};

export const BRIEF_FORMAT_VALUES = ['short', 'full'] as const;
export const BriefFormatStepInput = z.strictObject({ briefFormat: z.enum(BRIEF_FORMAT_VALUES) });
export type BriefFormatStepInput = z.infer<typeof BriefFormatStepInput>;

/** Reads the stored defaults, falling back to the starting ones for anything unreadable. */
export function readDelegationDefaults(value: unknown): DelegationDefaults {
  const parsed = DelegationDefaults.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_DELEGATION_DEFAULTS;
}

/** `onboarding.step.completed`: a step name and a count, never matter or personal content. */
export const OnboardingStepEvent = z.strictObject({
  name: z.literal('onboarding.step.completed'),
  path: z.enum(ONBOARDING_PATH_VALUES),
  step: z.string().max(32),
  skipped: z.boolean(),
});
export type OnboardingStepEvent = z.infer<typeof OnboardingStepEvent>;

/** Catalogue forums preselected for a practice city (lowercased): the principal seat of the city's High Court. */
export const DEFAULT_FORUM_CODES_BY_CITY: Readonly<Record<string, readonly string[]>> = {
  chennai: ['in.tn.madras-hc.principal.original', 'in.tn.madras-hc.principal.appellate'],
  bengaluru: ['in.ka.karnataka-hc.bengaluru'],
  bangalore: ['in.ka.karnataka-hc.bengaluru'],
};

/** The forum codes to preselect for `city`, or none when the city has no default. */
export function defaultForumCodesFor(city: string | null | undefined): readonly string[] {
  return DEFAULT_FORUM_CODES_BY_CITY[(city ?? '').trim().toLowerCase()] ?? [];
}

/** The practice city a bar council implies, to preselect that city's High Court. */
export const DEFAULT_CITY_BY_BAR_COUNCIL: Readonly<Record<string, string>> = {
  tamil_nadu_puducherry: 'Chennai',
  karnataka: 'Bengaluru',
};
