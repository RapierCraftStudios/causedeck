// `ClamAvScanner` (#43): clamd's INSTREAM command over TCP. The stream goes out as `zINSTREAM\0`,
// then chunks, each framed by a 4-byte big-endian length, then a zero length; clamd answers
// `stream: OK`, `stream: <signature> FOUND` or `... ERROR`. Stream size is limited by clamd's own
// `StreamMaxLength`, and `maxBytes` here stops sending before that: past it the result is `error`.
import net from 'node:net';

import type { ScanProvider, ScanResult } from './provider.ts';

export interface ClamAvOptions {
  host: string;
  port: number;
  /** Socket idle and overall timeout in milliseconds. */
  timeoutMs: number;
  /** The most bytes sent; clamd's default `StreamMaxLength` is 25 MB. */
  maxBytes: number;
  /** Replaced in tests; defaults to `net.createConnection`. */
  connect?: (host: string, port: number) => net.Socket;
}

/** Parse clamd's reply (`stream: OK`, `stream: X FOUND`, `... ERROR`). */
export function parseClamdReply(reply: string): ScanResult {
  const text = reply.replace(/\0/g, '').trim();
  if (/\bOK$/.test(text)) return { outcome: 'clean' };
  const found = /^stream:\s*(.+?)\s+FOUND$/.exec(text);
  if (found?.[1] !== undefined) return { outcome: 'infected', signature: found[1] };
  return { outcome: 'error', reason: 'scanner_error' };
}

function write(socket: net.Socket, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export class ClamAvScanner implements ScanProvider {
  readonly name = 'clamav';

  constructor(private readonly options: ClamAvOptions) {}

  async scan(stream: AsyncIterable<Uint8Array>): Promise<ScanResult> {
    const { host, port, timeoutMs, maxBytes } = this.options;
    const socket = (this.options.connect ?? ((h, p) => net.createConnection(p, h)))(host, port);
    socket.setTimeout(timeoutMs);

    const reply = new Promise<string>((resolve, reject) => {
      const parts: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => parts.push(chunk));
      socket.on('end', () => {
        resolve(Buffer.concat(parts).toString('utf8'));
      });
      socket.on('timeout', () => {
        reject(new Error('timeout'));
      });
      socket.on('error', reject);
    });
    // The reply promise may reject while a write is still pending; the outcome is read below.
    reply.catch(() => undefined);

    try {
      await write(socket, Buffer.from('zINSTREAM\0', 'latin1'));
      let sent = 0;
      for await (const chunk of stream) {
        sent += chunk.byteLength;
        if (sent > maxBytes) return { outcome: 'error', reason: 'too_large_to_scan' };
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.byteLength);
        await write(socket, header);
        await write(socket, chunk);
      }
      await write(socket, Buffer.alloc(4));
      return parseClamdReply(await reply);
    } catch {
      return { outcome: 'error', reason: 'scanner_unavailable' };
    } finally {
      socket.destroy();
    }
  }
}
