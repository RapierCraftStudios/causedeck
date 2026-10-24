// Bengaluru tribunals and commissions (#34, docs/strategy/11 §2.1, research/raw/09 §2.2-§2.5), all
// A0 except NCLT, which #38 raised to A1 with its table-format list adapter (migration 0049 raises
// existing rows; this seed keeps the level on every deploy), and the DRT and DRAT forums served by
// the `in.drt` adapter (#662). The NCLT adapter also serves the national benches and `in.drt` the
// DRT/DRAT forums listed below; the adapters' tests keep the codes in step. Consumer
// commission and RERA publication was not verified, so they list their reported hosts without deep
// links.
import type { ForumSeed } from '@causedeck/validators/forum';

const BENGALURU_LANGUAGES: ForumSeed['languageProfile'] = {
  primary: 'en',
  secondary: ['kn'],
  ocr: ['kn', 'en'],
};

const DRT_CONFIG: ForumSeed['config'] = {
  hosts: ['drt.gov.in'],
  deepLinks: {},
  notes: 'Cause-list and case-status pages not verified.',
};

const CONSUMER_CONFIG: ForumSeed['config'] = {
  hosts: ['confonet.nic.in', 'edaakhil.nic.in'],
  deepLinks: {},
  notes: 'ConfoNet (case status, cause lists) and e-Daakhil (filing); pages not verified.',
};

const NCLT_BENCHES: readonly (readonly [slug: string, bench: string, seat: string])[] = [
  ['new-delhi', 'Principal Bench (New Delhi)', 'New Delhi'],
  ['mumbai', 'Mumbai Bench', 'Mumbai'],
  ['chennai', 'Chennai Bench', 'Chennai'],
  ['kolkata', 'Kolkata Bench', 'Kolkata'],
  ['ahmedabad', 'Ahmedabad Bench', 'Ahmedabad'],
  ['hyderabad', 'Hyderabad Bench', 'Hyderabad'],
  ['allahabad', 'Allahabad Bench', 'Prayagraj'],
  ['chandigarh', 'Chandigarh Bench', 'Chandigarh'],
  ['guwahati', 'Guwahati Bench', 'Guwahati'],
  ['cuttack', 'Cuttack Bench', 'Cuttack'],
  ['jaipur', 'Jaipur Bench', 'Jaipur'],
  ['kochi', 'Kochi Bench', 'Kochi'],
  ['indore', 'Indore Bench', 'Indore'],
  ['amaravati', 'Amaravati Bench', 'Amaravati'],
];

const DRT_SEATS: readonly (readonly [slug: string, establishment: string, seat: string])[] = [
  ['delhi-1', 'DRT-1 Delhi', 'New Delhi'],
  ['delhi-2', 'DRT-2 Delhi', 'New Delhi'],
  ['delhi-3', 'DRT-3 Delhi', 'New Delhi'],
  ['mumbai-1', 'DRT-1 Mumbai', 'Mumbai'],
  ['mumbai-2', 'DRT-2 Mumbai', 'Mumbai'],
  ['mumbai-3', 'DRT-3 Mumbai', 'Mumbai'],
  ['chennai-1', 'DRT-1 Chennai', 'Chennai'],
  ['chennai-2', 'DRT-2 Chennai', 'Chennai'],
  ['chennai-3', 'DRT-3 Chennai', 'Chennai'],
  ['kolkata-1', 'DRT-1 Kolkata', 'Kolkata'],
  ['kolkata-2', 'DRT-2 Kolkata', 'Kolkata'],
  ['hyderabad', 'DRT Hyderabad', 'Hyderabad'],
  ['ahmedabad', 'DRT Ahmedabad', 'Ahmedabad'],
  ['pune', 'DRT Pune', 'Pune'],
  ['chandigarh-1', 'DRT-1 Chandigarh', 'Chandigarh'],
  ['jaipur', 'DRT Jaipur', 'Jaipur'],
  ['lucknow', 'DRT Lucknow', 'Lucknow'],
  ['ernakulam', 'DRT Ernakulam', 'Ernakulam'],
  ['coimbatore', 'DRT Coimbatore', 'Coimbatore'],
];

const DRAT_SEATS: readonly (readonly [slug: string, seat: string])[] = [
  ['mumbai', 'Mumbai'],
  ['delhi', 'New Delhi'],
  ['kolkata', 'Kolkata'],
  ['chennai', 'Chennai'],
  ['allahabad', 'Prayagraj'],
];

const DRAT_CONFIG: ForumSeed['config'] = {
  hosts: ['drt.gov.in'],
  deepLinks: {},
  notes: 'Appellate tribunal pages not verified.',
};

const NATIONAL_TRIBUNALS: readonly ForumSeed[] = [
  ...NCLT_BENCHES.map(([slug, establishment, seat]): ForumSeed => ({
    code: `in.nclt.${slug}`,
    court: 'National Company Law Tribunal',
    establishment,
    seat,
    side: 'not_applicable',
    jurisdictionKind: 'tribunal',
    languageProfile: { primary: 'en' },
    adapterId: 'in.nclt.bengaluru',
    adapterLevel: 'A1',
    enabled: true,
    config: {
      hosts: ['nclt.gov.in'],
      deepLinks: { cause_list: 'all-cause-list' },
      notes: 'One cause-list PDF per bench per date; read by the Bengaluru table adapter.',
    },
  })),
  ...DRT_SEATS.map(([slug, establishment, seat]): ForumSeed => ({
    code: `in.drt.${slug}`,
    court: 'Debts Recovery Tribunal',
    establishment,
    seat,
    side: 'not_applicable',
    jurisdictionKind: 'tribunal',
    languageProfile: { primary: 'en' },
    adapterId: 'in.drt',
    adapterLevel: 'A1',
    enabled: true,
    config: DRT_CONFIG,
  })),
  ...DRAT_SEATS.map(([slug, seat]): ForumSeed => ({
    code: `in.drat.${slug}`,
    court: 'Debts Recovery Appellate Tribunal',
    establishment: `DRAT ${seat}`,
    seat,
    side: 'not_applicable',
    jurisdictionKind: 'tribunal',
    languageProfile: { primary: 'en' },
    adapterId: 'in.drt',
    adapterLevel: 'A1',
    enabled: true,
    config: DRAT_CONFIG,
  })),
];

export const TRIBUNALS: readonly ForumSeed[] = [
  ...NATIONAL_TRIBUNALS,
  {
    code: 'in.nclt.bengaluru',
    court: 'National Company Law Tribunal',
    establishment: 'Bengaluru Bench',
    seat: 'Bengaluru',
    side: 'not_applicable',
    jurisdictionKind: 'tribunal',
    languageProfile: { primary: 'en' },
    adapterId: 'in.nclt.bengaluru',
    adapterLevel: 'A1',
    enabled: true,
    config: {
      hosts: ['nclt.gov.in'],
      deepLinks: { cause_list: 'all-cause-list' },
      notes: 'One cause-list PDF per bench per date.',
    },
  },
  {
    code: 'in.drt.bengaluru-1',
    court: 'Debts Recovery Tribunal',
    establishment: 'DRT-1 Bengaluru',
    seat: 'Bengaluru',
    side: 'not_applicable',
    jurisdictionKind: 'tribunal',
    languageProfile: { primary: 'en' },
    adapterId: 'in.drt',
    adapterLevel: 'A1',
    enabled: true,
    config: DRT_CONFIG,
  },
  {
    code: 'in.drt.bengaluru-2',
    court: 'Debts Recovery Tribunal',
    establishment: 'DRT-2 Bengaluru',
    seat: 'Bengaluru',
    side: 'not_applicable',
    jurisdictionKind: 'tribunal',
    languageProfile: { primary: 'en' },
    adapterId: 'in.drt',
    adapterLevel: 'A1',
    enabled: true,
    config: DRT_CONFIG,
  },
  {
    code: 'in.ka.consumer.bengaluru-urban-district',
    court: 'Consumer Disputes Redressal Commission',
    establishment: 'Bengaluru Urban District Commissions',
    seat: 'Bengaluru',
    side: 'not_applicable',
    jurisdictionKind: 'commission',
    languageProfile: BENGALURU_LANGUAGES,
    adapterLevel: 'A0',
    enabled: true,
    config: CONSUMER_CONFIG,
  },
  {
    code: 'in.ka.consumer.state-commission',
    court: 'Consumer Disputes Redressal Commission',
    establishment: 'Karnataka State Commission',
    seat: 'Bengaluru',
    side: 'not_applicable',
    jurisdictionKind: 'commission',
    languageProfile: BENGALURU_LANGUAGES,
    adapterLevel: 'A0',
    enabled: true,
    config: CONSUMER_CONFIG,
  },
  {
    code: 'in.ka.rera',
    court: 'Real Estate Regulatory Authority, Karnataka',
    establishment: 'RERA Karnataka',
    seat: 'Bengaluru',
    side: 'not_applicable',
    jurisdictionKind: 'tribunal',
    languageProfile: BENGALURU_LANGUAGES,
    adapterLevel: 'A0',
    enabled: true,
    config: {
      hosts: ['rera.karnataka.gov.in'],
      deepLinks: {},
      notes: 'Daily cause list reported on the authority site; layout not verified.',
    },
  },
];
