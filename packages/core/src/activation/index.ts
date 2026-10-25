// Product activation (#509, D-030): the funnel events behind the admin Growth page. Imports no other
// domain. Not re-exported from the package root: apps use `@causedeck/core/activation`.
export * from './record.ts';
export * from './funnel.ts';
