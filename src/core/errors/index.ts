/** Public contract of the errors capability: typed application errors shared across features. */
export {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  isAppError,
} from './app-error'
