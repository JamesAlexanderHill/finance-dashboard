function normalizeDescription(desc: string): string {
  return desc.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Compute the dedupeKey for an event.
 *
 * If the provider gives us an external event ID, we use:
 *   `{accountId}:{externalEventId}`
 *
 * Otherwise we SHA-256 hash the stable fields:
 *   hash({accountId}|{effectiveAt ISO}|{amountMinor}|{normalizedDescription})
 *
 * The primary leg's amountMinor is used for the hash path.
 *
 * `crypto` is imported dynamically so this server-only module (like
 * `~/core/auth/auth`) never pulls Node's `crypto` into the client bundle —
 * this function is only ever called from import commit server functions.
 */
export async function computeDedupeKey(params: {
  accountId: string
  externalEventId?: string | null
  effectiveAt: Date
  primaryAmountMinor: bigint
  description: string
}): Promise<string> {
  if (params.externalEventId) {
    return `${params.accountId}:${params.externalEventId}`
  }

  const input = [
    params.accountId,
    params.effectiveAt.toISOString(),
    params.primaryAmountMinor.toString(),
    normalizeDescription(params.description),
  ].join('|')

  const { createHash } = await import('crypto')
  return createHash('sha256').update(input).digest('hex')
}
