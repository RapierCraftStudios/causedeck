// Court-adapter framework (#369, ADR 0015): the zod-typed adapter contract, versioned config,
// registry, normalisers, access-mode enforcement, the `ListUnreadable` signal and the echo adapter.
// Nothing in this package makes a network request (lint-enforced in eslint.config.js).
export const packageName: string = '@causedeck/adapters';

export * from './access/enforce.ts';
export * from './config/schema.ts';
export * from './example/echo-adapter.ts';
export * from './normalise/index.ts';
export * from './registry.ts';
export * from './types.ts';
export * from './unreadable.ts';
