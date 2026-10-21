// Madras High Court (#34): the Principal Seat's Original and Appellate sides (A1, adapter #36) and
// the Madurai Bench, catalogued but disabled until its own adapter config (CL-12, v2). Hosts and
// page names from research/raw/08 §1 (services menu, read 2026-10-17): services are split across
// four hostnames, so `hosts` lists all four, the main site first. Halls, rosters and case types are
// not seeded: the adapters own them.
import type { ForumSeed } from '@causedeck/validators/forum';

const HOSTS = [
  'hcmadras.tn.gov.in',
  'mhc.tn.gov.in',
  'madrashighcourt.tn.gov.in',
  'judgments.ecourts.gov.in',
];

const PRINCIPAL_SEAT_CONFIG: ForumSeed['config'] = {
  hosts: HOSTS,
  deepLinks: {
    cause_list: 'cause_list_mhc.php',
    case_status: 'case_status_mas.php',
    orders: 'https://mhc.tn.gov.in/judis/',
    display_board: 'display_board_mhc.php',
    sitting_arrangements: 'sitting_arrangements.php',
    e_copy: 'https://mhc.tn.gov.in/eservices/copyapp/',
  },
  notes:
    'Cause list and case status searches sit behind a captcha: the lawyer opens them. Advocate Information Management System: https://madrashighcourt.tn.gov.in/aims/',
};

export const MADRAS_HC: readonly ForumSeed[] = [
  {
    code: 'in.tn.madras-hc.principal.original',
    court: 'Madras High Court',
    establishment: 'Principal Seat, Original Side',
    seat: 'Chennai',
    side: 'original',
    jurisdictionKind: 'high_court',
    languageProfile: { primary: 'en' },
    adapterId: 'in.tn.madras-hc.principal',
    adapterLevel: 'A1',
    enabled: true,
    config: PRINCIPAL_SEAT_CONFIG,
  },
  {
    code: 'in.tn.madras-hc.principal.appellate',
    court: 'Madras High Court',
    establishment: 'Principal Seat, Appellate Side',
    seat: 'Chennai',
    side: 'appellate',
    jurisdictionKind: 'high_court',
    languageProfile: { primary: 'en' },
    adapterId: 'in.tn.madras-hc.principal',
    adapterLevel: 'A1',
    enabled: true,
    config: PRINCIPAL_SEAT_CONFIG,
  },
  {
    code: 'in.tn.madras-hc.madurai',
    court: 'Madras High Court',
    establishment: 'Madurai Bench',
    seat: 'Madurai',
    side: 'appellate',
    jurisdictionKind: 'high_court',
    languageProfile: { primary: 'en' },
    adapterLevel: 'A0',
    enabled: false,
    config: {
      hosts: HOSTS,
      deepLinks: {
        cause_list: 'cause_list_mdu.php',
        case_status: 'case_status_mdu.php',
        display_board: 'display_board_mdu.php',
      },
      disabledReason: 'Separate adapter config planned in v2; no ordinary original jurisdiction.',
    },
  },
];
