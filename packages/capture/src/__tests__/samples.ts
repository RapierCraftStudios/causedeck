// Tiny synthetic files with real magic bytes, built in memory (no real documents, #43).
const padded = (...chunks: (string | Buffer)[]) =>
  new Uint8Array(
    Buffer.concat([
      ...chunks.map((c) => (typeof c === 'string' ? Buffer.from(c, 'hex') : c)),
      Buffer.alloc(256),
    ]),
  );

export const SAMPLES = {
  pdf: new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')),
  ics: new Uint8Array(Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')),
  txt: new Uint8Array(Buffer.from('[12/10/26, 10:01] Client: hearing moved to Monday\n')),
  eml: new Uint8Array(
    Buffer.from(
      'From: client@example.com\r\nTo: adv@example.com\r\nSubject: Hearing\r\n\r\nMonday\r\n',
    ),
  ),
  png: padded('89504e470d0a1a0a0000000d49484452'),
  jpeg: padded('ffd8ffe000104a46494600'),
  webp: padded(Buffer.from('RIFF'), '24000000', Buffer.from('WEBPVP8 ')),
  heic: padded('00000018', Buffer.from('ftypheic'), '00000000', Buffer.from('mif1heic')),
  m4a: padded('00000018', Buffer.from('ftypM4A '), '00000000', Buffer.from('M4A isom')),
  mp3: padded('fffb9064'),
  wav: padded(Buffer.from('RIFF'), '24000000', Buffer.from('WAVEfmt ')),
  ogg: padded(Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead')),
  webm: padded('1a45dfa39f4286810142f7810142f2810442f381084282847765626d'),
  html: new Uint8Array(Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>')),
  exe: padded('4d5a90000300000004000000ffff0000'),
} as const;

/** The filename and declared MIME a client would send for each sample. */
export const UPLOADS: Record<
  Exclude<keyof typeof SAMPLES, 'html' | 'exe'>,
  { filename: string; mime: string }
> = {
  pdf: { filename: 'Order 12.10.2026.pdf', mime: 'application/pdf' },
  ics: { filename: 'hearing.ics', mime: 'text/calendar' },
  txt: { filename: 'WhatsApp Chat.txt', mime: 'text/plain' },
  eml: { filename: 'mail.eml', mime: 'message/rfc822' },
  png: { filename: 'scan.png', mime: 'image/png' },
  jpeg: { filename: 'photo.JPG', mime: 'image/jpeg' },
  webp: { filename: 'photo.webp', mime: 'image/webp' },
  heic: { filename: 'IMG_0001.HEIC', mime: 'image/heic' },
  m4a: { filename: 'memo.m4a', mime: 'audio/x-m4a' },
  mp3: { filename: 'call.mp3', mime: 'audio/mpeg' },
  wav: { filename: 'dictation.wav', mime: 'audio/wav' },
  ogg: { filename: 'PTT-2026.opus', mime: 'audio/ogg' },
  webm: { filename: 'recording.webm', mime: 'audio/webm' },
};
