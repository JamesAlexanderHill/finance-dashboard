/**
 * Minimal authorization primitives shared by features that gate actions
 * behind a role (e.g. the workspaces capability's owner-only operations).
 * Intentionally generic — features define their own role types and pass them
 * in rather than this module knowing about any specific role set.
 */
import { ForbiddenError } from '~/core/errors'

export { ForbiddenError }

/** Throws a `ForbiddenError` unless `actual` is one of `allowed`. */
export function assertRole<Role extends string>(actual: Role, allowed: Role[], message: string): void {
  if (!allowed.includes(actual)) throw new ForbiddenError(message)
}
