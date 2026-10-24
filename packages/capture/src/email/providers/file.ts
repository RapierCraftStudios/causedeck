// The dev and CI inbound provider (#530): `.eml` files in a directory, announced by a
// shared-secret post whose `ref` is the file name.
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { verifyDevRequest, type InboundEmailProvider } from '../provider.ts';

export interface FileProviderOptions {
  dir: string;
  secret: string;
  readFile?: (file: string) => Promise<Uint8Array>;
  unlink?: (file: string) => Promise<void>;
}

/** A bare `.eml` file name: no separators, so a ref can never leave the directory. */
const FILE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.eml$/;

export function createFileProvider(options: FileProviderOptions): InboundEmailProvider {
  const read = options.readFile ?? ((file: string) => readFile(file));
  const remove = options.unlink ?? ((file: string) => unlink(file));
  const locate = (ref: string): string => {
    if (!FILE_REF.test(ref)) throw new Error('invalid file reference');
    return path.join(options.dir, ref);
  };
  return {
    id: 'file',
    verify: (request) => {
      const result = verifyDevRequest(request, options.secret);
      if (result.ok && !result.notifications.every((n) => FILE_REF.test(n.rawRef))) {
        return Promise.resolve({ ok: false, reason: 'bad_ref' });
      }
      return Promise.resolve(result);
    },
    fetchRaw: async (rawRef) => new Uint8Array(await read(locate(rawRef))),
    discardRaw: (rawRef) => remove(locate(rawRef)).catch(() => undefined),
  };
}
