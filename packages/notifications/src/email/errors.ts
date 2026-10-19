// Permanent versus transient send failures (#196). The delivery job retries a transient failure
// with backoff and records a permanent one as failed without retrying: sending the same message
// again cannot succeed (a rejected message, an unverified sender, a suspended account, an SMTP 5xx).
// Throttling, paused sending, 5xx from SES and network errors are transient. Pure: no I/O.

/** SES v2 error names that no retry can fix. */
const PERMANENT_SES_ERRORS: readonly string[] = [
  'MessageRejected',
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'NotFoundException',
  'BadRequestException',
];

/** SES v2 error names that are retried even though they are client faults. */
const TRANSIENT_SES_ERRORS: readonly string[] = [
  'TooManyRequestsException',
  'LimitExceededException',
  'SendingPausedException',
  'ThrottlingException',
  'Throttling',
];

interface ErrorShape {
  name?: unknown;
  code?: unknown;
  responseCode?: unknown;
  $metadata?: { httpStatusCode?: unknown };
}

function shape(error: unknown): ErrorShape {
  return typeof error === 'object' && error !== null ? error : {};
}

/** True when sending the same message again cannot succeed. */
export function isPermanentEmailError(error: unknown): boolean {
  const e = shape(error);
  const name = typeof e.name === 'string' ? e.name : '';
  if (TRANSIENT_SES_ERRORS.includes(name)) return false;
  if (PERMANENT_SES_ERRORS.includes(name)) return true;
  // SMTP (nodemailer): 5xx replies are permanent, 4xx are temporary.
  if (typeof e.responseCode === 'number') return e.responseCode >= 500 && e.responseCode < 600;
  // Any other SES client fault (4xx other than 429) is permanent; 5xx and 429 are retried.
  const status = e.$metadata?.httpStatusCode;
  if (typeof status === 'number') return status >= 400 && status < 500 && status !== 429;
  return false;
}

/** A short, content-free code for logs and the recorded delivery status. */
export function emailErrorCode(error: unknown): string {
  const e = shape(error);
  if (typeof e.responseCode === 'number') return `SMTP_${String(e.responseCode)}`;
  if (typeof e.name === 'string' && e.name !== '' && e.name !== 'Error') return e.name;
  if (typeof e.code === 'string' && e.code !== '') return e.code;
  return 'UNKNOWN';
}
