import { eq, and } from 'drizzle-orm'
import { db } from '~/db'
import { timelineAnnotations } from '~/db/schema'
import type { RecurrenceRule } from '~/lib/timeline-annotations'
import type { RequestContext } from '../utils/context'
import { buildPaginatedResult, type PaginationOptions } from '../utils/pagination'
import {
  queryAnnotationsByAccount,
  queryAnnotationsByWorkspace,
  queryAnnotationById,
} from '../query/annotation'

type CreateAnnotationData = {
  accountId: string
  label: string
  date: Date
  recurrence: RecurrenceRule | null
  color?: string | null
}

type UpdateAnnotationData = Partial<Omit<CreateAnnotationData, 'accountId'>>

async function listByAccount(ctx: RequestContext, accountId: string, opts: PaginationOptions = {}) {
  const { limit = 200, offset = 0 } = opts
  const { data, total } = await queryAnnotationsByAccount(ctx.workspaceId, accountId, opts)
  return buildPaginatedResult(data, total, limit, offset)
}

async function listByWorkspace(ctx: RequestContext, accountIds?: string[]) {
  return queryAnnotationsByWorkspace(ctx.workspaceId, accountIds)
}

async function getById(ctx: RequestContext, id: string) {
  return queryAnnotationById(ctx.workspaceId, id)
}

async function create(ctx: RequestContext, data: CreateAnnotationData) {
  const [row] = await db
    .insert(timelineAnnotations)
    .values({
      workspaceId: ctx.workspaceId,
      accountId: data.accountId,
      label: data.label.trim(),
      date: data.date,
      recurrence: data.recurrence ?? null,
      color: data.color ?? null,
    })
    .returning()
  return row
}

async function update(ctx: RequestContext, id: string, data: UpdateAnnotationData) {
  const existing = await queryAnnotationById(ctx.workspaceId, id)
  if (!existing) throw new Error(`Annotation not found: ${id}`)
  await db
    .update(timelineAnnotations)
    .set({
      ...(data.label !== undefined ? { label: data.label.trim() } : {}),
      ...(data.date !== undefined ? { date: data.date } : {}),
      ...(data.recurrence !== undefined ? { recurrence: data.recurrence } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    })
    .where(and(eq(timelineAnnotations.id, id), eq(timelineAnnotations.workspaceId, ctx.workspaceId)))
}

async function remove(ctx: RequestContext, id: string) {
  await db
    .delete(timelineAnnotations)
    .where(and(eq(timelineAnnotations.id, id), eq(timelineAnnotations.workspaceId, ctx.workspaceId)))
}

export const annotationService = {
  listByAccount,
  listByWorkspace,
  getById,
  create,
  update,
  delete: remove,
}
