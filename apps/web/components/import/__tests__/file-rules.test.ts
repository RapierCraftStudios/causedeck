// The drop zone rules of the bootstrap import (#552): 200-file cap, allow-list and size caps,
// de-duplication by hash.
import { ALLOWED_TYPES, DEFAULT_SIZE_CAPS_BYTES } from '@causedeck/capture';
import { describe, expect, it } from 'vitest';

import {
  admitFiles,
  classifyFile,
  MAX_IMPORT_FILES,
  type Candidate,
  IMPORT_FILE_TYPES,
  type ImportEntry,
} from '../../../lib/import/file-rules.ts';

const MB = 1024 * 1024;

const candidate = (n: number, over: Partial<Candidate> = {}): Candidate => ({
  id: `id-${String(n)}`,
  name: `list-${String(n)}.pdf`,
  sizeBytes: 1000,
  sha256: n.toString(16).padStart(64, '0'),
  ...over,
});

describe('IMPORT_FILE_TYPES', () => {
  it('mirrors the capture allow-list names, extensions and size caps', () => {
    for (const type of IMPORT_FILE_TYPES) {
      const server = ALLOWED_TYPES.find((entry) => entry.name === type.name);
      expect(server?.extensions, type.name).toEqual(type.extensions);
      expect(DEFAULT_SIZE_CAPS_BYTES[type.name], type.name).toBe(type.capBytes);
    }
  });
});

describe('classifyFile', () => {
  it('accepts the documents and pictures of the capture allow-list', () => {
    for (const name of [
      'a.pdf',
      'a.DOCX',
      'a.ics',
      'a.txt',
      'a.eml',
      'a.html',
      'a.HTM',
      'a.png',
      'a.jpg',
      'a.webp',
      'a.heic',
    ]) {
      expect(classifyFile(name, 10).ok).toBe(true);
    }
  });

  it('refuses a type outside the allow-list, an empty file and a file over its cap', () => {
    expect(classifyFile('run.exe', 10)).toEqual({ ok: false, reason: 'type', type: 'exe' });
    expect(classifyFile('noext', 10)).toEqual({ ok: false, reason: 'type', type: null });
    expect(classifyFile('a.pdf', 0)).toMatchObject({ ok: false, reason: 'empty' });
    expect(classifyFile('a.ics', 2 * MB)).toMatchObject({ ok: false, reason: 'size' });
    expect(classifyFile('a.pdf', 50 * MB)).toMatchObject({ ok: true });
  });
});

describe('admitFiles', () => {
  it('lists 200 files and refuses the 201st', () => {
    const incoming = Array.from({ length: MAX_IMPORT_FILES + 1 }, (_, n) => candidate(n));
    const { added, refused } = admitFiles([], incoming);
    expect(added).toHaveLength(MAX_IMPORT_FILES);
    expect(refused).toBe(1);
    expect(added.every((entry) => entry.status === 'queued')).toBe(true);
  });

  it('counts the files already listed against the cap', () => {
    const existing = Array.from({ length: 199 }, (_, n) => ({
      id: `e-${String(n)}`,
      name: 'a.pdf',
      sizeBytes: 1,
      type: 'pdf',
      status: 'uploaded',
    })) satisfies ImportEntry[];
    const { added, refused } = admitFiles(existing, [candidate(1000), candidate(1001)]);
    expect(added).toHaveLength(1);
    expect(refused).toBe(1);
  });

  it('marks a repeated content hash as a duplicate and a bad file as rejected', () => {
    const { added } = admitFiles(
      [],
      [
        candidate(1),
        candidate(2, { sha256: candidate(1).sha256 }),
        candidate(3, { name: 'x.exe' }),
      ],
    );
    expect(added.map((entry) => entry.status)).toEqual(['queued', 'duplicate', 'rejected']);
    expect(added[2]).toMatchObject({ reason: 'type' });
  });
});
