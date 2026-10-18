// Violation: a package (ui) imports an app (web).
import { appName } from '../../apps/web';

export const label: string = appName;
