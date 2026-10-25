// Fixtures for the upload, download and cross-tenant presign tests (#217): minimal files of each
// allowed type (real magic bytes, built in memory) and a `StorageCtx` for one member.
import { crc32 } from 'node:zlib';

import type { Queryable } from '@causedeck/db';

import type { MemoryObjectStore, StorageAction, StorageCtx } from '../index.ts';

/** A stored (uncompressed) zip archive of the given entries. */
export function zipOf(entries: readonly [string, string][]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    parts.push(local, fileName, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, fileName);
    offset += 30 + fileName.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

const padded = (...chunks: (string | Buffer)[]) =>
  new Uint8Array(
    Buffer.concat([
      ...chunks.map((c) => (typeof c === 'string' ? Buffer.from(c, 'hex') : c)),
      Buffer.alloc(256),
    ]),
  );

const DOCX_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
  'officedocument.wordprocessingml.document.main+xml"/></Types>';

/** One small, genuine-looking file per allowed type. */
export const SAMPLES = {
  pdf: new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')),
  docx: zipOf([
    ['[Content_Types].xml', DOCX_TYPES],
    ['word/document.xml', '<w:document/>'],
  ]),
  ics: new Uint8Array(Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')),
  txt: new Uint8Array(Buffer.from('[12/10/26, 10:01] Client: hearing moved to Monday\n')),
  png: padded('89504e470d0a1a0a0000000d49484452'),
  jpeg: padded('ffd8ffe000104a46494600'),
  heic: padded('00000018', Buffer.from('ftypheic'), '00000000', Buffer.from('mif1heic')),
  m4a: padded('00000018', Buffer.from('ftypM4A '), '00000000', Buffer.from('M4A isom')),
  mp3: padded('fffb9064'),
  wav: padded(Buffer.from('RIFF'), '24000000', Buffer.from('WAVEfmt ')),
  ogg: padded(Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead')),
  webm: padded('1a45dfa39f4286810142f7810142f2810442f381084282847765626d'),
  zip: zipOf([['chat.txt', 'exported chat']]),
  html: new Uint8Array(Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>')),
  exe: padded('4d5a90000300000004000000ffff0000'),
} as const;

export interface CtxOptions {
  db: Queryable;
  store: MemoryObjectStore;
  workspaceId: string;
  userId: string;
  /** Actions the caller may take; defaults to both. */
  allow?: readonly StorageAction[];
  now?: () => Date;
}

export class TestForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
}

export function ctxFor(options: CtxOptions): StorageCtx & { checked: StorageAction[] } {
  const allow = options.allow ?? ['document.read', 'document.write'];
  const checked: StorageAction[] = [];
  return {
    db: options.db,
    store: options.store,
    workspaceId: options.workspaceId,
    userId: options.userId,
    checked,
    authorize(action) {
      checked.push(action);
      if (!allow.includes(action)) throw new TestForbiddenError(action);
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

export async function errorOf(
  promise: Promise<unknown>,
): Promise<{ code?: unknown; name?: unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: unknown; name?: unknown };
  }
  throw new Error('expected a rejection');
}
