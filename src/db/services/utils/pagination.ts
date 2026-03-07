export type PaginationOptions = {
  limit?: number
  offset?: number
}

export type PaginatedResult<T> = {
  data: T[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasNext: boolean
  }
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
