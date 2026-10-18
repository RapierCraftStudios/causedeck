// Violation: ui is domain-free and may not depend on db.
import { tableName } from '../db';

export const table: string = tableName;
