// Lawyer memory (#72; PRD ME-1..ME-4, docs/product/10 §3). Memory is what the OS learns about how
// one lawyer practises, in layers M1 profile, M2 working preferences, M3 matter memory, M4 private
// court notes, M5 playbooks and the precedent bank (#901), M6 relationship memory and M7
// recognition memory. Every key
// is registered here per layer; a key outside the registry, or one that describes a judge or a
// bench, is rejected, because memory never profiles the bench (permanent guardrail).
import { z } from 'zod';

import { BRIEF_SECTION_KEYS } from './brief';

export const MEMORY_LAYERS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'] as const;
export const MemoryLayer = z.enum(MEMORY_LAYERS);
export type MemoryLayer = z.output<typeof MemoryLayer>;

export const MEMORY_SCOPES = ['user', 'workspace', 'matter'] as const;
export const MemoryScope = z.enum(MEMORY_SCOPES);
export type MemoryScope = z.output<typeof MemoryScope>;

export const MEMORY_STATUSES = ['active', 'paused', 'deleted'] as const;
export const MemoryStatus = z.enum(MEMORY_STATUSES);
export type MemoryStatus = z.output<typeof MemoryStatus>;

export const MEMORY_PROPOSAL_STATUSES = ['proposed', 'confirmed', 'dismissed'] as const;
export const MemoryProposalStatus = z.enum(MEMORY_PROPOSAL_STATUSES);
export type MemoryProposalStatus = z.output<typeof MemoryProposalStatus>;

export const MEMORY_SOURCE_TYPES = ['manual', 'edit', 'correction', 'capture', 'ai'] as const;
export const MemorySourceType = z.enum(MEMORY_SOURCE_TYPES);
export type MemorySourceType = z.output<typeof MemorySourceType>;

/** Where each layer's items may live. M3 is matter memory and never leaves its matter. */
export const LAYER_SCOPES: Readonly<Record<MemoryLayer, readonly MemoryScope[]>> = {
  M1: ['user', 'workspace'],
  M2: ['user', 'workspace'],
  M3: ['matter'],
  M4: ['user'],
  M5: ['user', 'workspace'],
  M6: ['user', 'workspace'],
  M7: ['user', 'workspace'],
};

export interface MemoryKeySpec {
  layer: MemoryLayer;
  /** A strategy-typed value: hidden from clerks even in an otherwise readable layer. */
  strategy: boolean;
  description: string;
}

/** The key registry, per layer. A key's prefix is its layer. */
export const MEMORY_KEYS = {
  'M1.courts': {
    layer: 'M1',
    strategy: false,
    description: 'Courts and forums the lawyer appears in',
  },
  'M1.practice_areas': { layer: 'M1', strategy: false, description: 'Practice areas' },
  'M1.enrolment_number': {
    layer: 'M1',
    strategy: false,
    description: 'Bar enrolment number (entered in onboarding)',
  },
  'M1.bar_council': {
    layer: 'M1',
    strategy: false,
    description: 'State bar council of enrolment (entered in onboarding)',
  },
  'M1.languages': { layer: 'M1', strategy: false, description: 'Working languages' },
  'M1.approach': { layer: 'M1', strategy: true, description: 'How the lawyer approaches a matter' },
  'M1.last_memory_review': {
    layer: 'M1',
    strategy: false,
    description: 'When the lawyer last completed the monthly memory review',
  },
  'M2.brief_format': { layer: 'M2', strategy: false, description: 'Preferred brief layout' },
  'M2.always_carry': {
    layer: 'M2',
    strategy: false,
    description: 'Papers always carried to a hearing',
  },
  'M2.reminder.evening_time': {
    layer: 'M2',
    strategy: false,
    description: 'Evening reminder time',
  },
  'M2.client_update_tone': { layer: 'M2', strategy: false, description: 'Tone of client updates' },
  'M2.settlement_posture': { layer: 'M2', strategy: true, description: 'Settlement preferences' },
  'M3.synopsis': {
    layer: 'M3',
    strategy: false,
    description: "What this matter is about, in the lawyer's words",
  },
  'M3.client_instruction': {
    layer: 'M3',
    strategy: false,
    description: 'A standing client instruction',
  },
  'M3.strategy_note': { layer: 'M3', strategy: true, description: 'A strategy note on the matter' },
  'M4.hall_note': {
    layer: 'M4',
    strategy: false,
    description: 'A practical note about a court hall or registry',
  },
  'M4.registry_tip': {
    layer: 'M4',
    strategy: false,
    description: 'A practical registry or filing tip',
  },
  'M5.playbook': {
    layer: 'M5',
    strategy: false,
    description: 'A playbook: preferred court format, standard prayers and annexure order',
  },
  'M5.precedent': {
    layer: 'M5',
    strategy: false,
    description: "A passage from the lawyer's own draft saved as a reusable precedent",
  },
  'M5.style': {
    layer: 'M5',
    strategy: false,
    description:
      'An explicit style preference (heading style, numbering, salutation, prayer wording)',
  },
  'M6.client_language': { layer: 'M6', strategy: false, description: 'Language a client prefers' },
  'M6.preferred_contact': {
    layer: 'M6',
    strategy: false,
    description: 'How a contact prefers to be reached',
  },
  'M7.party_alias': {
    layer: 'M7',
    strategy: false,
    description: 'A name a party is also known by',
  },
  'M7.matter_alias': {
    layer: 'M7',
    strategy: false,
    description: 'A name a matter is also known by',
  },
} as const satisfies Record<string, MemoryKeySpec>;

export type MemoryKey = keyof typeof MEMORY_KEYS;
export const MEMORY_KEY_LIST = Object.keys(MEMORY_KEYS) as MemoryKey[];

export function isMemoryKey(value: string): value is MemoryKey {
  return Object.hasOwn(MEMORY_KEYS, value);
}

export const layerOfKey = (key: MemoryKey): MemoryLayer => MEMORY_KEYS[key].layer;
export const isStrategyKey = (key: MemoryKey): boolean => MEMORY_KEYS[key].strategy;

/** Keys that name a judge or a bench in any segment are never allowed (bench profiling). */
const BENCH_KEY_WORDS = /(^|[._-])(judge|judges|bench|justice|magistrate|lordship)([._-]|$)/i;
/** Text that describes a judge or a bench. Memory holds the lawyer's own practical notes only. */
const BENCH_CONTENT =
  /\b(judges?|judge's|bench(es)?|justices?|magistrates?|lordships?|hon'?ble|honou?rable|his honou?r|her honou?r)\b/i;

export class MemoryGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryGuardError';
  }
}

export function benchKeyReason(key: string): string | null {
  return BENCH_KEY_WORDS.test(key)
    ? 'Memory cannot describe a judge or a bench: this key is not allowed'
    : null;
}

export function benchContentReason(value: MemoryValue): string | null {
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return strings.some((s) => BENCH_CONTENT.test(s))
    ? 'Memory cannot describe a judge or a bench: remove the reference and save your own practical note'
    : null;
}

/** Throws `MemoryGuardError` for a bench-describing key or value. */
export function assertNotBench(key: string, value: MemoryValue): void {
  // M5 holds the lawyer's own drafting text, which addresses "the Hon'ble Court" by necessity; the
  // key check still applies, and nothing in M5 describes a judge (it is a passage, not a profile).
  const reason = benchKeyReason(key) ?? (key.startsWith('M5.') ? null : benchContentReason(value));
  if (reason) throw new MemoryGuardError(reason);
}

const text = z.string().trim().min(1).max(4000);

export const MemoryValue = z.union([
  text,
  z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  z.record(z.string().max(60), z.union([z.string().max(1000), z.number(), z.boolean()])),
]);
export type MemoryValue = z.output<typeof MemoryValue>;

const uuid = z.uuid();

const MemoryTargetFields = {
  key: z.string(),
  value: MemoryValue,
  scope: MemoryScope,
  matterId: uuid.nullish(),
  personId: uuid.nullish(),
};

interface TargetShape {
  key: string;
  scope: MemoryScope;
  matterId?: string | null | undefined;
  personId?: string | null | undefined;
}

/** The layer, key and scope rules shared by proposals and notes. */
function checkTarget(input: TargetShape, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: string) => {
    ctx.addIssue({ code: 'custom', message, path: [path] });
  };
  if (!isMemoryKey(input.key)) {
    issue('Not a registered memory key', 'key');
    return;
  }
  const layer = layerOfKey(input.key);
  if (!LAYER_SCOPES[layer].includes(input.scope)) {
    issue(`${layer} memory cannot have ${input.scope} scope`, 'scope');
  }
  if (input.scope === 'matter' && !input.matterId) issue('Matter scope needs a matter', 'matterId');
  if (input.scope !== 'matter' && input.matterId)
    issue('Only matter scope names a matter', 'matterId');
  if (layer === 'M6' && !input.personId) issue('Relationship memory needs a person', 'personId');
  if (layer !== 'M6' && input.personId)
    issue('Only relationship memory names a person', 'personId');
}

export const MemoryProposalInput = z
  .strictObject({
    ...MemoryTargetFields,
    /** Why this is proposed: ids and counts, never quoted content. */
    evidence: z
      .record(
        z.string().max(60),
        z.union([
          z.string().max(500),
          z.number(),
          z.boolean(),
          z.array(z.string().max(100)).max(50),
        ]),
      )
      .default({}),
    sourceType: MemorySourceType.default('ai'),
    sourceRef: z.string().max(200).nullish(),
    anchorId: uuid.nullish(),
    confidence: z.number().min(0).max(1).nullish(),
  })
  .superRefine(checkTarget);
export type MemoryProposalInput = z.input<typeof MemoryProposalInput>;

/** A lawyer-authored note: saved at once, because the lawyer wrote it. */
export const MemoryNoteInput = z.strictObject(MemoryTargetFields).superRefine(checkTarget);
export type MemoryNoteInput = z.input<typeof MemoryNoteInput>;

export const MemoryPatch = z.strictObject({ value: MemoryValue });
export type MemoryPatch = z.input<typeof MemoryPatch>;

export const MemoryItem = z.strictObject({
  id: uuid,
  layer: MemoryLayer,
  key: z.string(),
  scope: MemoryScope,
  matterId: uuid.nullable(),
  personId: uuid.nullable(),
  value: MemoryValue,
  sourceType: z.union([MemorySourceType, z.literal('manual')]),
  sourceRef: z.string().nullable(),
  anchorId: uuid.nullable(),
  confidence: z.number().nullable(),
  confirmationState: z.enum(['confirmed', 'corrected']),
  status: MemoryStatus,
  sharedWithChamber: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MemoryItem = z.output<typeof MemoryItem>;

export const MemoryProposal = z.strictObject({
  id: uuid,
  layer: MemoryLayer,
  key: z.string(),
  scope: MemoryScope,
  matterId: uuid.nullable(),
  personId: uuid.nullable(),
  proposedValue: MemoryValue,
  evidence: z.record(z.string(), z.unknown()),
  status: MemoryProposalStatus,
  proposedAt: z.date(),
  decidedAt: z.date().nullable(),
});
export type MemoryProposal = z.output<typeof MemoryProposal>;

export const MEMORY_USED_IN = ['brief', 'draft', 'matching'] as const;
export const MemoryUsedIn = z.enum(MEMORY_USED_IN);
export type MemoryUsedIn = z.output<typeof MemoryUsedIn>;

export const MemoryForInput = z.strictObject({
  matterId: uuid.nullish(),
  layers: z.array(MemoryLayer).min(1),
  purpose: MemoryUsedIn,
});
export type MemoryForInput = z.input<typeof MemoryForInput>;

/** An edit pattern needs the same edit in this many outputs, and a dismissed one rests this long. */
export const EDIT_PATTERN_THRESHOLD = 3;
export const DISMISSED_PROPOSAL_REST_DAYS = 60;

export const MemoryEditObservation = z.strictObject({
  /** The brief or draft the edit was made in. */
  outputId: uuid,
  /** A short normalised label of the edit ('carry vakalat copy'), never document text. */
  pattern: z.string().trim().min(1).max(200),
  key: z.string(),
  scope: MemoryScope.default('user'),
  matterId: uuid.nullish(),
});
export type MemoryEditObservation = z.input<typeof MemoryEditObservation>;

export const MemoryCorrectionInput = z.strictObject({
  /** What the lawyer typed or the system matched ('Rajan'). */
  alias: z.string().trim().min(1).max(200),
  /** What the lawyer corrected it to ('M. Rajan s/o Murugan'). */
  canonical: z.string().trim().min(1).max(200),
  target: z.enum(['party', 'matter']).default('party'),
});
export type MemoryCorrectionInput = z.input<typeof MemoryCorrectionInput>;

// How memory values steer outputs (#74). A stored value is free-form (`MemoryValue`); the exported
// zod schemas below describe each readable shape, and the `read*` helpers give the consumers one
// typed view and ignore what they cannot read, so a malformed value falls
// back to the default rather than breaking a brief or a draft.

export type BriefSectionKey = (typeof BRIEF_SECTION_KEYS)[number];
export const BRIEF_VERBOSITIES = ['short', 'full'] as const;
export type BriefVerbosity = (typeof BRIEF_VERBOSITIES)[number];

/** The member's M2 brief format: section order (listed sections first) and verbosity. */
export interface BriefFormat {
  order: BriefSectionKey[];
  verbosity: BriefVerbosity;
}

export const DEFAULT_BRIEF_FORMAT: BriefFormat = {
  order: [...BRIEF_SECTION_KEYS],
  verbosity: 'full',
};

const isSection = (v: string): v is BriefSectionKey =>
  (BRIEF_SECTION_KEYS as readonly string[]).includes(v);

const BriefVerbositySchema = z.enum(BRIEF_VERBOSITIES);
export const BriefFormatValue = z.union([
  z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(BriefVerbositySchema),
  z.looseObject({
    order: z.string().optional().catch(undefined),
    verbosity: BriefVerbositySchema.optional().catch(undefined),
  }),
]);

/** `M2.brief_format`: 'short' | 'full', or {order: 'carry,stage,...', verbosity}; null if unreadable. */
export function readBriefFormat(value: MemoryValue): BriefFormat | null {
  const parsed = BriefFormatValue.safeParse(value);
  if (!parsed.success) return null;
  if (typeof parsed.data === 'string') return { ...DEFAULT_BRIEF_FORMAT, verbosity: parsed.data };
  const first = (parsed.data.order?.split(',') ?? []).map((s) => s.trim()).filter(isSection);
  if (first.length === 0 && parsed.data.verbosity === undefined) return null;
  return {
    order: [...new Set([...first, ...BRIEF_SECTION_KEYS])],
    verbosity: parsed.data.verbosity ?? 'full',
  };
}

export const AlwaysCarryRule = z.strictObject({
  label: z.string().trim().min(1),
  /** 'first_hearing': only on the first listing of a proceeding; 'always' otherwise. */
  when: z.enum(['always', 'first_hearing']).default('always'),
});
export type AlwaysCarryRule = z.output<typeof AlwaysCarryRule>;

export const AlwaysCarryValue = z.union([
  z.string().transform((label) => [{ label, when: 'always' as const }]),
  z
    .array(z.string())
    .transform((labels) => labels.map((label) => ({ label, when: 'always' as const }))),
  z
    .looseObject({ label: z.string().trim().min(1), when: z.unknown().optional() })
    .transform(({ label, when }) => [
      { label, when: when === 'first_hearing' ? ('first_hearing' as const) : ('always' as const) },
    ]),
]);

/** `M2.always_carry`: a label, a list of labels, or {label, when}; unreadable gives no rule. */
export function readAlwaysCarry(value: MemoryValue): AlwaysCarryRule[] {
  const parsed = AlwaysCarryValue.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export const OUTWARD_TONE_VALUES = ['formal', 'brief', 'warm'] as const;
export const OUTWARD_LANGUAGE_VALUES = ['en', 'ta', 'kn'] as const;
export const OutwardTone = z.string().trim().toLowerCase().pipe(z.enum(OUTWARD_TONE_VALUES));
/** `M6.client_language`: 'en' | 'ta' | 'kn' or the English name of one of them. */
export const OutwardLanguage = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => ({ english: 'en', tamil: 'ta', kannada: 'kn' })[v] ?? v)
  .pipe(z.enum(OUTWARD_LANGUAGE_VALUES));

export const ClientUpdateStyleValue = z.union([
  OutwardTone.transform((tone) => ({ tone })),
  z.looseObject({
    tone: OutwardTone.optional().catch(undefined),
    sign_off: z.string().trim().min(1).optional().catch(undefined),
  }),
]);

/** `M2.client_update_tone`: a tone, or {tone, sign_off}; fields that cannot be read are absent. */
export function readClientUpdateStyle(value: MemoryValue): {
  tone?: (typeof OUTWARD_TONE_VALUES)[number];
  signOff?: string;
} {
  const parsed = ClientUpdateStyleValue.safeParse(value);
  if (!parsed.success) return {};
  const data = parsed.data as { tone?: (typeof OUTWARD_TONE_VALUES)[number]; sign_off?: string };
  return {
    ...(data.tone === undefined ? {} : { tone: data.tone }),
    ...(data.sign_off === undefined ? {} : { signOff: data.sign_off }),
  };
}

/** `M6.client_language`: 'en' | 'ta' | 'kn' or the English name of one of them. */
export function readClientLanguage(
  value: MemoryValue,
): (typeof OUTWARD_LANGUAGE_VALUES)[number] | null {
  const parsed = OutwardLanguage.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const AliasValue = z.looseObject({
  alias: z.string().min(1),
  canonical: z.string().min(1),
});

/** An `M7` alias value: what was typed and what it stands for. */
export function readAlias(value: MemoryValue): { alias: string; canonical: string } | null {
  const parsed = AliasValue.safeParse(value);
  return parsed.success ? { alias: parsed.data.alias, canonical: parsed.data.canonical } : null;
}

/** A matching hint input (#74): an M7 alias only ever raises or lowers ranking, never auto-applies. */
export const MatchingHintInput = z.strictObject({
  alias: z.string().min(1),
  canonical: z.string().min(1),
  target: z.enum(['party', 'matter']).default('party'),
});
export type MatchingHintInput = z.input<typeof MatchingHintInput>;

// M5 precedent bank (#901). A passage is proposed from a draft the lawyer exported (L2), and saved
// only when they confirm it; dismissing records a reason code and the same passage rests 30 days.
export const PRECEDENT_KINDS = [
  'prayer',
  'ground',
  'facts',
  'averment',
  'argument',
  'annexure_list',
  'other',
] as const;
export const PrecedentKind = z.enum(PRECEDENT_KINDS);
export type PrecedentKind = z.output<typeof PrecedentKind>;

export const PRECEDENT_STATUSES = ['active', 'retired', 'deleted'] as const;
export type PrecedentStatus = (typeof PRECEDENT_STATUSES)[number];

export const PRECEDENT_DISMISS_REASONS = [
  'not_reusable',
  'too_specific',
  'incorrect',
  'already_saved',
  'other',
] as const;
export const PrecedentDismissReason = z.enum(PRECEDENT_DISMISS_REASONS);
export type PrecedentDismissReason = z.output<typeof PrecedentDismissReason>;

/** The same passage is not proposed again for this long after a dismissal. */
export const PRECEDENT_DISMISS_REST_DAYS = 30;

/** Where a passage came from: one block of one immutable draft version. */
export const PrecedentSourceAnchor = z.strictObject({
  draftVersionId: uuid,
  anchorId: z.string().min(1).max(200),
});
export type PrecedentSourceAnchor = z.output<typeof PrecedentSourceAnchor>;

export const PrecedentProposalSchema = z.strictObject({
  passageText: text,
  kind: PrecedentKind,
  courtId: uuid.nullable(),
  language: z.string().trim().min(2).max(16).default('en'),
  sourceAnchor: PrecedentSourceAnchor,
  confidence: z.number().min(0).max(1),
});
export type PrecedentProposalInput = z.input<typeof PrecedentProposalSchema>;

/** A playbook: the lawyer's preferred format per court, standard prayers and annexure order. */
export const PlaybookSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  courtId: uuid.nullable(),
  /** The preferred document format for the court, e.g. `writ_petition`. */
  format: z.string().trim().min(1).max(80),
  standardPrayers: z.array(z.string().trim().min(1).max(500)).max(10),
  annexureOrder: z.array(z.string().trim().min(1).max(100)).max(20),
});
export type Playbook = z.output<typeof PlaybookSchema>;
export type PlaybookInput = z.input<typeof PlaybookSchema>;
