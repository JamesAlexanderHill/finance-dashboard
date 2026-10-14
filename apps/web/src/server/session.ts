import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { requireWorkspace } from './session.server';

/** Server-function middleware: every finance server function runs scoped to the caller's workspace. */
export const workspaceMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const ctx = await requireWorkspace(getRequest());
  return next({ context: ctx });
});
