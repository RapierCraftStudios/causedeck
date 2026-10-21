// Bengaluru tribunals and commissions (#34, docs/strategy/11 §2.1, research/raw/09 §2.2-§2.5), all
// A0 except NCLT Bengaluru, which #38 raised to A1 with its table-format list adapter (migration
// 0047 raises existing rows; this seed keeps the level on every deploy). DRT, consumer
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

export const TRIBUNALS: readonly ForumSeed[] = [
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
    adapterLevel: 'A0',
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
    adapterLevel: 'A0',
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
