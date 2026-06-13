import type { RequestContext } from '../utils/context'
import { queryCategoriesByWorkspace } from '../query/category'

async function list(ctx: RequestContext) {
  return queryCategoriesByWorkspace(ctx.workspaceId)
}

export const categoryService = { list }
