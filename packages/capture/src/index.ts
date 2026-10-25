/** Capture inbox ingestion (#43): allow-list, status machine, retention rules, scan providers. */
export const packageName: string = '@causedeck/capture';

export * from './allow-list.ts';
export * from './config.ts';
export * from './email/index.ts';
export * from './ics/index.ts';
export * from './import/index.ts';
export * from './jobs.ts';
export * from './retention.ts';
export * from './scan/index.ts';
export * from './status.ts';
export * from './types.ts';
export * from './whatsapp-inbound/index.ts';
export * from './whatsapp/index.ts';
export * from './whatsapp/structure.ts';
export * from './whatsapp/to-proposals.ts';
export * from './whatsapp/validate-selection.ts';
