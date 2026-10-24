// eCourts establishment snapshot (#635, part of #495): a reviewed JSON file of district-court
// establishments (code, state, district, name) with its provenance, imported into the forum
// catalogue as A0 seed rows. Nothing here fetches anything: the data comes from a cleared source
// (#640) that a person reviews and commits. The validator reports every problem at once.
import { FORUM_CODE_PATTERN, type ForumSeed } from '@causedeck/validators/forum';

/** State and union-territory codes, the second segment of an imported forum code. */
export const ECOURTS_STATES = {
  an: 'Andaman and Nicobar Islands',
  ap: 'Andhra Pradesh',
  ar: 'Arunachal Pradesh',
  as: 'Assam',
  br: 'Bihar',
  ch: 'Chandigarh',
  cg: 'Chhattisgarh',
  dd: 'Dadra and Nagar Haveli and Daman and Diu',
  dl: 'Delhi',
  ga: 'Goa',
  gj: 'Gujarat',
  hr: 'Haryana',
  hp: 'Himachal Pradesh',
  jk: 'Jammu and Kashmir',
  jh: 'Jharkhand',
  ka: 'Karnataka',
  kl: 'Kerala',
  la: 'Ladakh',
  ld: 'Lakshadweep',
  mp: 'Madhya Pradesh',
  mh: 'Maharashtra',
  mn: 'Manipur',
  ml: 'Meghalaya',
  mz: 'Mizoram',
  nl: 'Nagaland',
  od: 'Odisha',
  py: 'Puducherry',
  pb: 'Punjab',
  rj: 'Rajasthan',
  sk: 'Sikkim',
  tn: 'Tamil Nadu',
  ts: 'Telangana',
  tr: 'Tripura',
  up: 'Uttar Pradesh',
  uk: 'Uttarakhand',
  wb: 'West Bengal',
} as const;
export type EcourtsStateCode = keyof typeof ECOURTS_STATES;

/**
 * The per-state adapter level: the A1 upgrade is this data flag, set when a state's fixtures pass.
 * A state not listed here is A0.
 */
export const ECOURTS_STATE_LEVELS: Partial<Record<EcourtsStateCode, 'A0' | 'A1'>> = {};

export interface EcourtsEstablishment {
  /** The portal's establishment code (letters, digits, hyphens). */
  code: string;
  state: string;
  district: string;
  establishment: string;
}

export interface EcourtsSnapshot {
  /** Where the list came from (a named, cleared source). */
  source: string;
  /** The licence or permission it is used under. */
  licence: string;
  /** The date the list was retrieved, `YYYY-MM-DD`. */
  retrievedOn: string;
  establishments: readonly EcourtsEstablishment[];
}

const ESTABLISHMENT_CODE = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Validate a parsed snapshot; throws one error listing every problem. */
export function validateSnapshot(raw: unknown): EcourtsSnapshot {
  const problems: string[] = [];
  const obj = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isText(obj['source'])) problems.push('missing provenance: source');
  if (!isText(obj['licence'])) problems.push('missing provenance: licence');
  if (typeof obj['retrievedOn'] !== 'string' || !DATE.test(obj['retrievedOn'])) {
    problems.push('missing provenance: retrievedOn (YYYY-MM-DD)');
  }
  const list = obj['establishments'];
  if (!Array.isArray(list)) {
    problems.push('establishments must be an array');
    throw new Error(`invalid eCourts snapshot: ${problems.join('; ')}`);
  }
  const seen = new Set<string>();
  list.forEach((item: unknown, i) => {
    const e = (item !== null && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const at = `establishments[${String(i)}]`;
    const code = e['code'];
    if (typeof code !== 'string' || !ESTABLISHMENT_CODE.test(code)) {
      problems.push(`${at}: invalid code ${JSON.stringify(code)}`);
    } else {
      const key = `${String(e['state'])}/${code.toLowerCase()}`;
      if (seen.has(key))
        problems.push(`${at}: duplicate code ${code} in state ${String(e['state'])}`);
      seen.add(key);
    }
    if (typeof e['state'] !== 'string' || !Object.hasOwn(ECOURTS_STATES, e['state'])) {
      problems.push(`${at}: unknown state ${JSON.stringify(e['state'])}`);
    }
    if (!isText(e['district'])) problems.push(`${at}: missing district`);
    if (!isText(e['establishment'])) problems.push(`${at}: missing establishment name`);
  });
  if (problems.length > 0) throw new Error(`invalid eCourts snapshot: ${problems.join('; ')}`);
  return raw as EcourtsSnapshot;
}

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export interface SnapshotToSeedsOptions {
  /** Codes already in the hand-written catalogue: those rows are skipped, never duplicated. */
  skipCodes?: ReadonlySet<string>;
  levels?: Partial<Record<EcourtsStateCode, 'A0' | 'A1'>>;
}

/** Map a validated snapshot to A0 (or the state's flagged level) district forum seeds. */
export function snapshotToForumSeeds(
  snapshot: EcourtsSnapshot,
  { skipCodes = new Set(), levels = ECOURTS_STATE_LEVELS }: SnapshotToSeedsOptions = {},
): ForumSeed[] {
  const seeds: ForumSeed[] = [];
  for (const e of snapshot.establishments) {
    const state = e.state as EcourtsStateCode;
    const district = slug(e.district);
    const code = `in.${state}.${district}.${slug(e.establishment) || 'establishment'}-${e.code.toLowerCase()}`;
    if (skipCodes.has(code) || !FORUM_CODE_PATTERN.test(code)) continue;
    seeds.push({
      code,
      court: `${e.district} District Courts`,
      establishment: e.establishment,
      seat: e.district,
      side: 'not_applicable',
      jurisdictionKind: 'district',
      languageProfile: { primary: 'en' },
      adapterId: `in.${state}.district`,
      adapterLevel: levels[state] ?? 'A0',
      enabled: true,
      config: {
        hosts: ['services.ecourts.gov.in'],
        deepLinks: {},
        notes: 'District eCourts services; cause lists and case status sit behind a captcha.',
      },
    });
  }
  return seeds;
}
