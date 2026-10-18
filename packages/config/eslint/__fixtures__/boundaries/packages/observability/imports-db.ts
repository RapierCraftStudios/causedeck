// Not allowed: observability must not depend on domain packages (#13).
import { tableName } from '../db';

export const table: string = tableName;
