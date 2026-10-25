// TEMPORARY (diag/e2e-556, do not merge): timestamped harness logs under test-results/diag.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/* eslint-disable no-process-env */
export const DIAG = process.env.E2E_DIAG === '1';
const dir = path.resolve(process.cwd(), 'test-results/diag');

export function diagLog(file: string, msg: string): void {
  if (!DIAG) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, file), `${new Date().toISOString()} ${msg}\n`);
}
