// Not allowed: db must not depend on domain packages (#297).
import { billingName } from '../billing';

export const name: string = billingName;
