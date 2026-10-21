import type { CourtsIndex, CourtsIndexForum, DisabledForum } from '@causedeck/core/court';

/** A Madras HC-like forum; override what a case needs. */
export function forum(overrides: Partial<CourtsIndexForum> = {}): CourtsIndexForum {
  const code = overrides.code ?? 'in.tn.madras-hc.principal.appellate';
  return {
    id: `id-${code}`,
    code,
    court: 'Madras High Court',
    establishment: 'Principal Seat, Appellate Side',
    seat: 'Chennai',
    side: 'appellate',
    languageProfile: { primary: 'en' },
    adapterId: 'in.tn.madras-hc.principal',
    adapterLevel: 'A1',
    workspaceOwned: false,
    latestParse: null,
    officialList: {
      url: 'https://court.example/cause_list.php',
      fallbacks: [],
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    ...overrides,
  };
}

export function disabledForum(overrides: Partial<DisabledForum> = {}): DisabledForum {
  return {
    id: 'id-madurai',
    code: 'in.tn.madras-hc.madurai',
    court: 'Madras High Court',
    establishment: 'Madurai Bench',
    seat: 'Madurai',
    reason: 'Needs its own adapter configuration.',
    ...overrides,
  };
}

/** Bengaluru (two courts) and Chennai (one court, three forums), plus three planned forums. */
export function sampleIndex(): CourtsIndex {
  const chennai = [
    forum({
      code: 'in.tn.madras-hc.principal.original',
      establishment: 'Principal Seat, Original Side',
      side: 'original',
    }),
    forum(),
    forum({ code: 'in.tn.madras-hc.extra', establishment: 'Extra Bench', side: 'not_applicable' }),
  ];
  return {
    cities: [
      {
        city: 'Bengaluru',
        courts: [
          {
            court: 'Karnataka High Court',
            forums: [
              forum({
                code: 'in.ka.karnataka-hc.bengaluru',
                court: 'Karnataka High Court',
                establishment: 'Principal Bench',
                seat: 'Bengaluru',
                side: 'not_applicable',
                adapterLevel: 'A0',
                languageProfile: { primary: 'en', secondary: ['kn'] },
              }),
            ],
          },
          {
            court: 'City Civil Court',
            forums: [
              forum({
                code: 'in.ka.bengaluru.city-civil',
                court: 'City Civil Court',
                establishment: null,
                seat: 'Bengaluru',
                side: 'not_applicable',
                adapterLevel: 'A0',
              }),
            ],
          },
        ],
      },
      { city: 'Chennai', courts: [{ court: 'Madras High Court', forums: chennai }] },
    ],
    disabled: [
      disabledForum(),
      disabledForum({
        id: 'id-dharwad',
        code: 'in.ka.karnataka-hc.dharwad',
        court: 'Karnataka High Court',
        establishment: 'Dharwad Bench',
        seat: 'Dharwad',
      }),
      disabledForum({
        id: 'id-kalaburagi',
        code: 'in.ka.karnataka-hc.kalaburagi',
        court: 'Karnataka High Court',
        establishment: 'Kalaburagi Bench',
        seat: 'Kalaburagi',
        reason: null,
      }),
    ],
  };
}
