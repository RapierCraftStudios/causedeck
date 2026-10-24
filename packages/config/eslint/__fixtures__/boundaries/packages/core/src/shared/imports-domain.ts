// Not allowed: shared/ imports no domain.
import { planCode } from '../billing/index.ts';

export const sharedPlan: string = planCode;
