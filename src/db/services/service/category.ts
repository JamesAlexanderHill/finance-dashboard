import type { RequestContext } from '../utils/context'
import { queryCategoriesByUser } from '../query/category'

async function list(ctx: RequestContext) {
  return queryCategoriesByUser(ctx.userId)
}

export const categoryService = { list }
