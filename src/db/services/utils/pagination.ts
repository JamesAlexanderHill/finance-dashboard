export type PaginationOptions = {
  limit?: number
  offset?: number
}

export type PaginationData = {
  total: number
  limit: number
  offset: number
  hasNext: boolean
}

export type PaginatedResult<T> = {
  data: T[]
  pagination: PaginationData,
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  limit: number,
  offset: number,
): PaginatedResult<T> {
  return {
    data,
    pagination: {
      total,
      limit,
      offset,
      hasNext: offset + data.length < total,
    },
  }
}
