// Plain text: UTF-8, one page per form feed.
export function readPlainText(data: Uint8Array): string[] {
  const text = new TextDecoder('utf-8').decode(data);
  return text.split('\f');
}
