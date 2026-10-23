// Domain errors for the notifications service (#194). Codes are a subset of the API error codes
// (`@causedeck/validators/api` API_ERROR_CODES), so routes and server actions map them 1:1.
export type NotificationErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION';

export class NotificationError extends Error {
  readonly code: NotificationErrorCode;

  constructor(code: NotificationErrorCode, message: string) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
  }
}

export function notFound(message = 'Notification not found'): NotificationError {
  return new NotificationError('NOT_FOUND', message);
}

export function forbidden(
  message = 'Notifications go only to active members of this workspace',
): NotificationError {
  return new NotificationError('FORBIDDEN', message);
}

export function invalid(message: string): NotificationError {
  return new NotificationError('VALIDATION', message);
}
