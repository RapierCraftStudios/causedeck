// Job error classification (spike §3.2). Throwing `PermanentError` sends the job straight to its
// dead-letter queue; `RetryableError` (and any other error) is retried with backoff. Messages must
// not carry payload content: they end up in logs, spans and the job's stored output.

export class RetryableError extends Error {
  override name = 'RetryableError';
  readonly code: string;

  constructor(code: string, message: string = code, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export class PermanentError extends Error {
  override name = 'PermanentError';
  readonly code: string;

  constructor(code: string, message: string = code, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
