// DOCX text through mammoth (raw text, no HTML). A DOCX has no fixed pages, so the text is one page.
// A file mammoth cannot open is corrupt; one it opens but finds no text in (images only, embedded
// objects) is returned empty and the pipeline treats it as unreadable.
export class DocxReadError extends Error {
  override name = 'DocxReadError';

  constructor(cause?: unknown) {
    super('docx unreadable', { cause });
  }
}

export async function readDocxText(data: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth');
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    return result.value;
  } catch (error) {
    throw new DocxReadError(error);
  }
}
