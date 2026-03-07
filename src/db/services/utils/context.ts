export type RequestContext = {
  userId: string
  // RBAC: add roles/permissions here when needed
}

export function createContext(userId: string): RequestContext {
  return { userId }
}
