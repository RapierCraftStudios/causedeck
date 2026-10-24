// CSV for bulk seat provisioning (#684, part of #508): a small RFC 4180 reader (BOM, CRLF, quoted
// fields) and the row rules. Columns: `email` (required), `name` and `role` (optional; the role
// defaults to `viewer`). A bad row is reported with its line and never stops the others.
import { isRole } from '@causedeck/auth/policy';

/** Data rows (not counting the header) one run may carry. */
export const MAX_PROVISIONING_ROWS = 500;

/** The role a row gets when the file has no role column or the cell is empty. */
export const DEFAULT_PROVISIONING_ROLE = 'viewer';

/** Roles a CSV may grant; `owner` is only ever set by an ownership transfer. */
export type ProvisioningRole = 'advocate' | 'junior' | 'clerk' | 'viewer';

export interface ProvisioningCsvRow {
  /** 1-based line of the record in the file (the header is line 1). */
  line: number;
  email: string;
  name: string | null;
  role: ProvisioningRole;
}

export interface ProvisioningCsvError {
  line: number;
  message: string;
}

export interface ParsedProvisioningCsv {
  rows: ProvisioningCsvRow[];
  errors: ProvisioningCsvError[];
}

// Deliberately loose, like the invite dialog: the mail send is the real check.
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/u;

/** Split CSV text into records of fields. Quoted fields may hold commas, quotes ("") and newlines. */
function records(text: string): { line: number; fields: string[] }[] {
  const out: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRecord = () => {
    fields.push(field);
    if (fields.some((f) => f.trim() !== '')) out.push({ line: start, fields });
    fields = [];
    field = '';
  };
  const source = text.replace(/^﻿/u, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      start = line;
    } else {
      field += char;
    }
  }
  if (field !== '' || fields.length > 0) endRecord();
  return out;
}

/** Parse the file: one row per distinct, valid email (the first occurrence wins). */
export function parseProvisioningCsv(text: string): ParsedProvisioningCsv {
  const [header, ...data] = records(text);
  const rows: ProvisioningCsvRow[] = [];
  const errors: ProvisioningCsvError[] = [];
  if (!header) return { rows, errors: [{ line: 1, message: 'The file is empty' }] };
  const columns = header.fields.map((f) => f.trim().toLowerCase());
  const emailAt = columns.indexOf('email');
  if (emailAt < 0) return { rows, errors: [{ line: header.line, message: 'Missing "email" column' }] };
  const nameAt = columns.indexOf('name');
  const roleAt = columns.indexOf('role');

  const seen = new Set<string>();
  for (const { line, fields } of data) {
    if (rows.length + errors.length >= MAX_PROVISIONING_ROWS) {
      errors.push({ line, message: `More than ${MAX_PROVISIONING_ROWS} rows; split the file` });
      break;
    }
    const email = (fields[emailAt] ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) {
      errors.push({ line, message: 'Invalid email address' });
      continue;
    }
    const role = ((roleAt >= 0 ? fields[roleAt] : undefined) ?? '').trim().toLowerCase();
    const granted = role === '' ? DEFAULT_PROVISIONING_ROLE : role;
    if (!isRole(granted) || granted === 'owner') {
      errors.push({ line, message: `Unknown or not grantable role: ${role}` });
      continue;
    }
    if (seen.has(email)) {
      errors.push({ line, message: 'Duplicate email in the file' });
      continue;
    }
    seen.add(email);
    const name = (nameAt >= 0 ? (fields[nameAt] ?? '') : '').trim();
    rows.push({ line, email, name: name === '' ? null : name, role: granted });
  }
  return { rows, errors };
}
