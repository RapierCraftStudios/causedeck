// Allowed: usage → billing is declared, and the import goes through billing/index.ts.
import { planCode } from '../billing/index.ts';

export const viaIndex: string = planCode;
