// `manifest.json` and `README.txt` of a workspace export (#301; format in
// docs/engineering/data-lifecycle.md). The manifest is the last data entry: it lists every other
// entry with its sha256 and size (and row count for data files), so anyone can check the archive
// with standard tools (`sha256sum`). README.txt explains the layout in plain words.
import { createHash } from 'node:crypto';

import type { ExportScope } from '@causedeck/db/schema';

export const MANIFEST_VERSION = 1;
export const MANIFEST_PATH = 'manifest.json';
export const README_PATH = 'README.txt';

export interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  /** Rows, for `data/` files. */
  rows?: number;
}

export interface ExportManifest {
  version: typeof MANIFEST_VERSION;
  exportId: string;
  workspaceId: string;
  scope: ExportScope;
  createdAt: string;
  /** Rows per exported table. */
  counts: Record<string, number>;
  /** Number of original files under `files/`. */
  fileCount: number;
  /** Tenant tables left out on purpose, with the reason. */
  excluded: Record<string, string>;
  files: ManifestFile[];
}

export function buildManifest(input: Omit<ExportManifest, 'version'>): ExportManifest {
  return { version: MANIFEST_VERSION, ...input };
}

export function encodeManifest(manifest: ExportManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

export function readmeText(input: {
  workspaceName: string;
  createdAt: string;
  scope: ExportScope;
}) {
  const who =
    input.scope === 'user'
      ? 'your own records in this workspace'
      : 'everything stored for this workspace';
  return [
    `CauseDeck export of "${input.workspaceName}"`,
    `Created ${input.createdAt} (UTC). This archive holds ${who}.`,
    '',
    'Contents',
    '  manifest.json        Every file in this archive with its SHA-256 checksum and size, and the',
    '                       number of rows exported from each table.',
    '  data/<table>.jsonl   One JSON object per line for every row of the table.',
    '  data/<table>.csv     The same rows as a spreadsheet, for the main tables.',
    '  files/<kind>/<id>-<name>   The original files you uploaded, decrypted.',
    '',
    'Checking the archive',
    '  Compare the SHA-256 of each file (for example with `sha256sum`) with manifest.json.',
    '',
    'Privacy',
    '  This archive contains confidential workspace data. Store it securely and delete it when you',
    '  no longer need it. CauseDeck keeps it for 24 hours after it is ready, then deletes it.',
    '',
  ].join('\r\n');
}

export interface ManifestMismatch {
  path: string;
  problem: 'missing' | 'sha256' | 'bytes' | 'unlisted';
}

/**
 * Recompute every listed file's sha256 and size from the archive's entries. Every entry except the
 * manifest itself must be listed.
 */
export function verifyManifest(
  manifest: ExportManifest,
  entries: ReadonlyMap<string, Uint8Array>,
): ManifestMismatch[] {
  const problems: ManifestMismatch[] = [];
  const listed = new Set<string>();
  for (const file of manifest.files) {
    listed.add(file.path);
    const bytes = entries.get(file.path);
    if (bytes === undefined) {
      problems.push({ path: file.path, problem: 'missing' });
      continue;
    }
    if (bytes.byteLength !== file.bytes) problems.push({ path: file.path, problem: 'bytes' });
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      problems.push({ path: file.path, problem: 'sha256' });
    }
  }
  for (const path of entries.keys()) {
    if (path !== MANIFEST_PATH && !listed.has(path)) problems.push({ path, problem: 'unlisted' });
  }
  return problems;
}
