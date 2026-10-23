// Permanent versus transient send failures (#196): the delivery job retries only transient ones.
import { describe, expect, it } from 'vitest';

import { emailErrorCode, isPermanentEmailError } from '../errors.ts';

const ses = (name: string, httpStatusCode: number) =>
  Object.assign(new Error('x'), { name, $metadata: { httpStatusCode } });
const smtp = (responseCode: number) => Object.assign(new Error('x'), { responseCode });

describe('isPermanentEmailError', () => {
  it.each([
    ses('MessageRejected', 400),
    ses('MailFromDomainNotVerifiedException', 400),
    ses('AccountSuspendedException', 400),
    ses('SomeOtherClientFault', 403),
    smtp(550),
  ])('treats %s as permanent', (error) => {
    expect(isPermanentEmailError(error)).toBe(true);
  });

  it.each([
    ses('TooManyRequestsException', 429),
    ses('SendingPausedException', 400),
    ses('LimitExceededException', 400),
    ses('InternalFailure', 500),
    smtp(421),
    new Error('ECONNRESET'),
    'not an error',
    null,
  ])('treats %s as transient', (error) => {
    expect(isPermanentEmailError(error)).toBe(false);
  });
});

describe('emailErrorCode', () => {
  it('names the error without its message', () => {
    expect(emailErrorCode(ses('MessageRejected', 400))).toBe('MessageRejected');
    expect(emailErrorCode(smtp(550))).toBe('SMTP_550');
    expect(emailErrorCode(Object.assign(new Error('to a@b.test'), { code: 'ECONNRESET' }))).toBe(
      'ECONNRESET',
    );
    expect(emailErrorCode(new Error('to a@b.test'))).toBe('UNKNOWN');
  });
});
