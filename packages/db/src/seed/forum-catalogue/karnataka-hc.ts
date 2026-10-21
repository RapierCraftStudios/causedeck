// Karnataka High Court (#34): the Principal Bench at Bengaluru (A1, adapter #37), and the Dharwad and
// Kalaburagi Benches, catalogued but disabled (CL-12, v2). Pages from research/raw/09 §1 (read
// 2026-10-17 on `judiciary.karnataka.gov.in`; the legacy NIC host was unreachable, so it is not
// listed). The cause-list and display-board pages serve all three benches behind a bench selector.
import type { ForumSeed } from '@causedeck/validators/forum';

const HOSTS = ['judiciary.karnataka.gov.in'];

const DEEP_LINKS: ForumSeed['config']['deepLinks'] = {
  cause_list: 'causelistp.php',
  case_status: 'casemenu.php',
  orders: 'rep_judgment.php',
  display_board: 'display_board_bench.php',
};

const BENCH_DISABLED_REASON =
  'Bench catalogued for completeness; its cause lists and adapter config are planned in v2.';

export const KARNATAKA_HC: readonly ForumSeed[] = [
  {
    code: 'in.ka.karnataka-hc.bengaluru',
    court: 'High Court of Karnataka',
    establishment: 'Principal Bench',
    seat: 'Bengaluru',
    side: 'not_applicable',
    jurisdictionKind: 'high_court',
    languageProfile: { primary: 'en' },
    adapterId: 'in.ka.karnataka-hc.bengaluru',
    adapterLevel: 'A1',
    enabled: true,
    config: {
      hosts: HOSTS,
      deepLinks: DEEP_LINKS,
      notes:
        'Entire cause list (PDF): entire_causelist.php. Quick e-Filing: casediary/login.php. Case status and judgment searches sit behind a captcha: the lawyer opens them.',
    },
  },
  {
    code: 'in.ka.karnataka-hc.dharwad',
    court: 'High Court of Karnataka',
    establishment: 'Dharwad Bench',
    seat: 'Dharwad',
    side: 'not_applicable',
    jurisdictionKind: 'high_court',
    languageProfile: { primary: 'en' },
    adapterLevel: 'A0',
    enabled: false,
    config: { hosts: HOSTS, deepLinks: DEEP_LINKS, disabledReason: BENCH_DISABLED_REASON },
  },
  {
    code: 'in.ka.karnataka-hc.kalaburagi',
    court: 'High Court of Karnataka',
    establishment: 'Kalaburagi Bench',
    seat: 'Kalaburagi',
    side: 'not_applicable',
    jurisdictionKind: 'high_court',
    languageProfile: { primary: 'en' },
    adapterLevel: 'A0',
    enabled: false,
    config: { hosts: HOSTS, deepLinks: DEEP_LINKS, disabledReason: BENCH_DISABLED_REASON },
  },
];
