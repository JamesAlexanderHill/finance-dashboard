/**
 * Base class for expected, typed application errors — the kind a route or
 * server function should catch and translate into a specific user-facing
 * response, as opposed to an unexpected bug. Each subclass carries an HTTP
 * status so a shared error boundary/handler can map it consistently.
 */
export class AppError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = new.target.name
    this.status = status
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403)
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input') {
    super(message, 400)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409)
  }
}

/** True for any error this module defines (as opposed to an unexpected/unknown error). */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}
