// Trust vocabulary shared by every pattern (#9, spike §7). Plain data: patterns take these as props
// and import nothing from core, db or apps.

/** Automation level. There is deliberately no L5: nothing is ever sent, filed or paid for the lawyer. */
export type Level = 'L1' | 'L2' | 'L3' | 'L4';

export const LEVELS: readonly Level[] = ['L1', 'L2', 'L3', 'L4'];

/** Where a fact came from, and whether the lawyer has confirmed it. */
export type ProvenanceSource = {
  kind: 'document' | 'capture' | 'adapter' | 'ai' | 'import' | 'manual' | 'system';
  label: string;
  quote?: string;
  page?: number;
  anchorId?: string;
  confidence?: number;
  state: 'proposed' | 'confirmed' | 'edited' | 'rejected';
};

export type ProvenanceKind = ProvenanceSource['kind'];
export type ProvenanceState = ProvenanceSource['state'];

/** A change Lawyer OS proposes and the lawyer confirms (always L2). */
export type Proposal<T> = {
  id: string;
  title: string;
  before?: T;
  after: T;
  source: ProvenanceSource;
  level: 'L2';
  safe?: boolean;
};

/** The excerpt of a source document a fact was read from; `ProvenanceSource.anchorId` points here. */
export type Anchor = {
  id: string;
  documentTitle: string;
  quote: string;
  /** Character range of the matched span inside `quote`. */
  highlight?: { start: number; end: number };
  page: number;
  pageCount?: number;
  /** A photographed page: the line to show cropped out of the image (#52). */
  imageRegion?: AnchorImageRegion;
};

/** `bbox` is `[x0, y0, x1, y1]` normalised 0..1 over the page image at `src`. */
export type AnchorImageRegion = {
  src: string;
  bbox: [number, number, number, number];
  /** Width over height of the whole image; defaults to an A4 page. */
  aspect?: number;
  alt?: string;
};

/** Proceeding stages, in filing order. Names match the `--stage-*` tokens. */
export const PROCEEDING_STAGES = [
  'filed',
  'sr_fr',
  'defects',
  're_presented',
  'numbered',
  'disposed',
] as const;

/** Cause-list stages for a numbered matter. */
export const LISTING_STAGES = ['listed', 'reserved', 'part-heard'] as const;

export type Stage = (typeof PROCEEDING_STAGES | typeof LISTING_STAGES)[number];

/** Lawyer memory scopes M1-M7 (`memory_item`, docs/product/10-lawyer-os-system-architecture.md). */
export const MEMORY_SCOPES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/** Where an obligation stands against its due date. */
export type DueState = 'upcoming' | 'due-today' | 'overdue' | 'done';

/** The person (or Lawyer OS itself) an activity or obligation belongs to. */
export type Person = { name: string; avatarUrl?: string };
