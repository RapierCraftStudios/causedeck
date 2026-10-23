// Court-adapter framework (#369, ADR 0015): the zod-typed adapter contract, versioned config,
// registry, normalisers, access-mode enforcement, the `ListUnreadable` signal, the echo adapter, the
// PDF, HTML and text layout readers (#370), config checksums and the pure parse-health monitor
// (#372), the Madras HC adapter (#395), the Karnataka HC adapter (#404) and the NCLT Bengaluru
// table adapter (#38, ADR 0020) and the A0 generic adapter (#56, ADR 0030). The versioned-config
// loader, activation and run recorder need the database and live in `@causedeck/adapters/server`.
// Nothing in this package makes a network request (lint-enforced in eslint.config.js).
export const packageName: string = '@causedeck/adapters';

export * from './access/enforce.ts';
export * from './config/checksum.ts';
export * from './config/schema.ts';
export * from './example/echo-adapter.ts';
export * from './generic-a0/index.ts';
export * from './health/monitor.ts';
export * from './karnataka-hc/index.ts';
export * from './layout/index.ts';
export * from './madras-hc/index.ts';
export * from './nclt-blr/index.ts';
export * from './normalise/index.ts';
export * from './registry.ts';
export * from './types.ts';
export * from './unreadable.ts';
