// Shared pg enums of the matter graph (#32 data contract, #344). The court-layer tables (court.ts)
// use some of them now; the matter, proceeding, listing, obligation, people and document tables use
// the rest in their own parts (#345-#348). Values the contract writes as `in (...)` (matter status,
// proceeding_link kind, anchor kind, obligation closed_reason_type) stay CHECK constraints there.
// The provenance enums are declared beside `provenance()` in columns.ts and re-exported here.
import { pgEnum } from 'drizzle-orm/pg-core';

export {
  CONFIRMATION_STATES,
  confirmationState,
  SOURCE_TYPES,
  sourceType,
  type ConfirmationState,
  type SourceType,
} from '../columns.ts';

export const FORUM_SIDES = ['original', 'appellate', 'not_applicable'] as const;
export type ForumSide = (typeof FORUM_SIDES)[number];
export const forumSide = pgEnum('forum_side', FORUM_SIDES);

export const JURISDICTION_KINDS = [
  'high_court',
  'district',
  'tribunal',
  'commission',
  'other',
] as const;
export type JurisdictionKind = (typeof JURISDICTION_KINDS)[number];
export const jurisdictionKind = pgEnum('jurisdiction_kind', JURISDICTION_KINDS);

export const ADAPTER_LEVELS = ['A0', 'A1', 'A2', 'A3'] as const;
export type AdapterLevel = (typeof ADAPTER_LEVELS)[number];
export const adapterLevel = pgEnum('adapter_level', ADAPTER_LEVELS);

export const BENCH_KINDS = ['single', 'division', 'full', 'other'] as const;
export type BenchKind = (typeof BENCH_KINDS)[number];
export const benchKind = pgEnum('bench_kind', BENCH_KINDS);

export const PROCEEDING_KINDS = ['main', 'misc', 'appeal', 'connected'] as const;
export type ProceedingKind = (typeof PROCEEDING_KINDS)[number];
export const proceedingKind = pgEnum('proceeding_kind', PROCEEDING_KINDS);

/** The pre-numbering lifecycle (launch-markets research §2). */
export const PROCEEDING_STATES = [
  'filed',
  'sr_fr',
  'defects',
  're_presented',
  'numbered',
  'disposed',
] as const;
export type ProceedingState = (typeof PROCEEDING_STATES)[number];
export const proceedingState = pgEnum('proceeding_state', PROCEEDING_STATES);

export const LIST_TYPES = ['daily', 'advance', 'supplementary', 'special'] as const;
export type ListType = (typeof LIST_TYPES)[number];
export const listType = pgEnum('list_type', LIST_TYPES);

export const APPEARANCE_CAPACITIES = ['aor', 'arguing', 'for_other', 'proxy', 'assisting'] as const;
export type AppearanceCapacity = (typeof APPEARANCE_CAPACITIES)[number];
export const appearanceCapacity = pgEnum('appearance_capacity', APPEARANCE_CAPACITIES);

export const ORDER_TYPES = ['interim', 'final', 'procedural'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const orderType = pgEnum('order_type', ORDER_TYPES);

export const OBLIGATION_SOURCES = [
  'order_direction',
  'rule',
  'registry_defect',
  'client',
  'internal',
  'certified_copy',
] as const;
export type ObligationSource = (typeof OBLIGATION_SOURCES)[number];
export const obligationSource = pgEnum('obligation_source', OBLIGATION_SOURCES);

export const OBLIGATION_STATUSES = ['open', 'done', 'not_applicable', 'superseded'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];
export const obligationStatus = pgEnum('obligation_status', OBLIGATION_STATUSES);

export const PERSON_KINDS = [
  'party',
  'advocate',
  'judge_staff',
  'client',
  'professional',
  'other',
] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];
export const personKind = pgEnum('person_kind', PERSON_KINDS);

export const ROLE_EDGE_KINDS = [
  'represents',
  'appears_for',
  'instructed_by',
  'assigned_to',
  'opposes',
] as const;
export type RoleEdgeKind = (typeof ROLE_EDGE_KINDS)[number];
export const roleEdgeKind = pgEnum('role_edge_kind', ROLE_EDGE_KINDS);

export const DOCUMENT_KINDS = [
  'pleading',
  'ia',
  'annexure',
  'order',
  'judgment',
  'cause_list',
  'correspondence',
  'note',
  'draft',
  'registry_memo',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const documentKind = pgEnum('document_kind', DOCUMENT_KINDS);

export const DOCUMENT_TEXT_STATUSES = ['pending', 'layer', 'ocr', 'failed', 'skipped'] as const;
export type DocumentTextStatus = (typeof DOCUMENT_TEXT_STATUSES)[number];
export const documentTextStatus = pgEnum('document_text_status', DOCUMENT_TEXT_STATUSES);
