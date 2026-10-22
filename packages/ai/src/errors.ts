// Typed gateway errors. Messages never carry input, output or credentials; callers map them to
// user-facing copy by `code`.
export class AiGatewayError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The workspace's AI budget is spent: surfaces as "AI paused for this workspace this month". */
export class BudgetExceededError extends AiGatewayError {
  constructor() {
    super('BUDGET_EXCEEDED', 'AI paused for this workspace this month; manual entry still works');
  }
}

/** India-only mode is on and the task routes to a provider outside India. */
export class ResidencyViolationError extends AiGatewayError {
  constructor(task: string, provider: string) {
    super(
      'RESIDENCY_VIOLATION',
      `India-only AI is on: task ${task} routes to ${provider}, which is not in-region`,
    );
  }
}

/** The matter is sensitive or the capture is `ai_blocked`: no AI processing. */
export class SensitiveMatterBlockedError extends AiGatewayError {
  constructor() {
    super('SENSITIVE_MATTER_BLOCKED', 'AI is disabled for this matter or capture');
  }
}

/** The provider's output failed the task schema twice; nothing is returned. */
export class OutputInvalidError extends AiGatewayError {
  constructor(task: string) {
    super('OUTPUT_INVALID', `the model output for ${task} did not match its schema`);
  }
}

export class UnknownTaskError extends AiGatewayError {
  constructor(task: string) {
    super('UNKNOWN_TASK', `unknown AI task: ${task}`);
  }
}

export class InvalidInputError extends AiGatewayError {
  constructor(task: string, issues: string) {
    super('INVALID_INPUT', `invalid input for ${task}: ${issues}`);
  }
}

/** No provider can serve the task (none registered, or none supports it). */
export class NoProviderError extends AiGatewayError {
  constructor(task: string) {
    super('NO_PROVIDER', `no provider available for ${task}`);
  }
}

/** A provider call failed. `retryable` is true for throttling and transient 5xx. */
export class ProviderError extends AiGatewayError {
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(
    provider: string,
    message: string,
    opts: { retryable?: boolean; status?: number } = {},
  ) {
    super('PROVIDER_ERROR', `${provider}: ${message}`);
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
  }
}

/** The provider's circuit breaker is open. Treated as retryable for failover. */
export class CircuitOpenError extends ProviderError {
  constructor(provider: string) {
    super(provider, 'circuit open', { retryable: true });
  }
}
