/** Capture inbox ingestion (#43): allow-list, status machine, retention rules, scan providers. */
export const packageName: string = '@causedeck/capture';

export * from './allow-list.ts';
export * from './config.ts';
export * from './email/index.ts';
export * from './jobs.ts';
export * from './retention.ts';
export * from './scan/index.ts';
export * from './status.ts';
export * from './types.ts';
