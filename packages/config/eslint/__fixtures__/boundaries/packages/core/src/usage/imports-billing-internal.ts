// Not allowed: a deep import into another domain's internals.
import { planCode } from '../billing/internal.ts';

export const viaInternal: string = planCode;
