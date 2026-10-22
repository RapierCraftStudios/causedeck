/** Capture inbox ingestion (#43): allow-list, status machine, retention rules, scan providers. */
export const packageName: string = '@causedeck/capture';

export * from './allow-list.ts';
export * from './config.ts';
export * from './email/allow-list.ts';
export * from './email/mime.ts';
export * from './email/registry.ts';
export * from './email/sanitize.ts';
export * from './email/types.ts';
export * from './email/unwrap.ts';
export * from './jobs.ts';
export * from './retention.ts';
export * from './scan/index.ts';
export * from './status.ts';
export * from './types.ts';
