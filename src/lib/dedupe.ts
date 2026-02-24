import { createHash } from 'crypto'

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
 */
export function computeDedupeKey(params: {
  accountId: string
  externalEventId?: string | null
  effectiveAt: Date
  primaryAmountMinor: bigint
  description: string
}): string {
  if (params.externalEventId) {
    return `${params.accountId}:${params.externalEventId}`
  }

  const input = [
    params.accountId,
    params.effectiveAt.toISOString(),
    params.primaryAmountMinor.toString(),
    normalizeDescription(params.description),
  ].join('|')

  return createHash('sha256').update(input).digest('hex')
}
