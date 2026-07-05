import { queryLegsWithLineItemsByDate } from './category-spending'

export async function querySankeyLegs(
  workspaceId: string,
  dateRange?: { start: string | null; end: string },
) {
  return queryLegsWithLineItemsByDate(workspaceId, dateRange)
}
