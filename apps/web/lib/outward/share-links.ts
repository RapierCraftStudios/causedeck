// The only ways an outward draft leaves the app (#736, ADR 0045): a `wa.me` or `mailto:` link the
// lawyer opens themselves, a clipboard copy, or a file download. Nothing here transmits anything;
// the lawyer's own app (or file manager) does the sending.

/** WhatsApp's click-to-chat link with the text prefilled; the lawyer picks the recipient there. */
export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** A `mailto:` link with subject and body prefilled; the lawyer addresses it in their mail app. */
export function mailtoHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A file name safe on every platform: letters and digits of any script, `-`, no path characters. */
export function draftFileName(matterTitle: string): string {
  const slug = matterTitle
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug === '' ? 'update' : slug}.txt`;
}

/** Save `text` as a UTF-8 text file through the browser; the data never leaves the device. */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Open a hand-off link in a new window, without a referrer or access to this page. */
export function openExternal(href: string): void {
  window.open(href, '_blank', 'noopener,noreferrer');
}
