// Not allowed: audit declares no dependency on billing, even through its index.
import { planCode } from '../billing/index.ts';

export const auditPlan: string = planCode;
