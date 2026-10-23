// The fallback parser (#528): the body becomes a text capture and each attachment the capture
// allow-list accepts becomes a capture. Type comes from extension, declared MIME and magic bytes
// together, and the size caps apply; a refused attachment is a diagnostic, never an error.
import {
  assertBytesMatch,
  assertWithinCap,
  isUnsupportedTypeError,
  resolveAllowedType,
  CaptureTooLargeError,
} from '../../allow-list.ts';
import type {
  EmailAttachment,
  IntakeCapture,
  IntakeContext,
  IntakeDiagnostic,
  IntakeEmail,
  IntakeParser,
  IntakeResult,
} from '../types.ts';

const encoder = new TextEncoder();

const safeName = (subject: string) =>
  `${
    subject
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'email'
  }.txt`;

/** The body as a text capture; null when the message has no text. */
export function bodyCapture(email: IntakeEmail): IntakeCapture | null {
  const body = email.body.trim();
  if (body === '') return null;
  return {
    source: 'body',
    fileName: safeName(email.subject),
    mime: 'text/plain',
    content: encoder.encode(body),
  };
}

/** Attachments the capture allow-list accepts; the rest become diagnostics. */
export async function allowedAttachments(
  attachments: readonly EmailAttachment[],
  ctx: IntakeContext,
): Promise<{ captures: IntakeCapture[]; diagnostics: IntakeDiagnostic[] }> {
  const captures: IntakeCapture[] = [];
  const diagnostics: IntakeDiagnostic[] = [];
  for (const attachment of attachments) {
    try {
      const type = resolveAllowedType(attachment.fileName, attachment.contentType);
      assertWithinCap(type, attachment.content.byteLength, ctx.sizeCapOverrides);
      const mime = await assertBytesMatch(type, attachment.content);
      captures.push({
        source: 'attachment',
        fileName: attachment.fileName,
        mime,
        content: attachment.content,
      });
    } catch (error) {
      const reason = isUnsupportedTypeError(error)
        ? error.reason
        : error instanceof CaptureTooLargeError
          ? 'too_large'
          : null;
      if (reason === null) throw error;
      diagnostics.push({
        code: 'attachment_rejected',
        severity: 'warn',
        message: `attachment ${attachment.fileName} was not captured: ${reason}`,
      });
    }
  }
  return { captures, diagnostics };
}

export const genericParser: IntakeParser = {
  id: 'generic',
  match: () => 0.1,
  async parse(email, ctx): Promise<IntakeResult> {
    const body = bodyCapture(email);
    const attached = await allowedAttachments(email.attachments, ctx);
    return {
      captures: [...(body === null ? [] : [body]), ...attached.captures],
      drafts: [],
      diagnostics: attached.diagnostics,
    };
  },
};
