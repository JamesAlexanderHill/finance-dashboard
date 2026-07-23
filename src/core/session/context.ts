export type RequestContext = {
  userId: string
  workspaceId: string
  // RBAC: add roles/permissions here when needed
}

export function createContext(userId: string, workspaceId: string): RequestContext {
  return { userId, workspaceId }
}
