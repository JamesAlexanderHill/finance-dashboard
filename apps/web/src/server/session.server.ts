import { auth } from './auth';
import { workspaceForUser } from './workspace';

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
  }
}

/** Resolves the signed-in user and their workspace from the session cookie, server-side only. */
export async function requireWorkspace(request: Request) {
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) throw new UnauthorizedError();
  const workspaceId = await workspaceForUser(s.user.id);
  if (!workspaceId) throw new UnauthorizedError();
  return { userId: s.user.id, email: s.user.email, name: s.user.name, workspaceId };
}
