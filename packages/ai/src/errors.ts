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

/**
 * The preview-only ChatGPT plan provider hit the plan's usage limit
 * (`subscription_sharing_usage_limit_exceeded`). Not retried or failed over; callers surface it as
 * a client-safe "plan limit reached" error, never an invented answer.
 */
export class PlanLimitReachedError extends AiGatewayError {
  constructor() {
    super('PLAN_LIMIT_REACHED', 'ChatGPT plan limit reached; try again later');
  }
}

/**
 * The preview-only ChatGPT plan provider cannot serve plan usage right now (usage unavailable, the
 * account cannot use it, or the sign-in needs renewing). Not retried or failed over.
 */
export class PlanUnavailableError extends AiGatewayError {
  /** `reason` is fixed copy from the adapter (e.g. 'sign-in needs renewing'), never a server body. */
  constructor(reason?: string) {
    super(
      'PLAN_UNAVAILABLE',
      reason === undefined
        ? 'ChatGPT plan usage is unavailable right now'
        : `ChatGPT plan usage is unavailable right now (${reason})`,
    );
  }
}

/** The provider's circuit breaker is open. Treated as retryable for failover. */
export class CircuitOpenError extends ProviderError {
  constructor(provider: string) {
    super(provider, 'circuit open', { retryable: true });
  }
}
