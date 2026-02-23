import { createHash } from "crypto";

function normalizeDescription(desc: string): string {
  return desc.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Compute the dedupeKey for an event.
 *
 * If the provider gives us an external transaction ID, we use:
 *   `{accountId}:{externalId}`
 *
 * Otherwise we content-hash the stable fields:
 *   SHA-256({accountId}|{effectiveAt ISO}|{amountMinor}|{normalizedDescription})
 */
export function computeDedupeKey(params: {
  accountId: string;
  externalId?: string | null;
  effectiveAt: Date;
  /** The primary/first leg amount in minor units (used only for the hash path) */
  amountMinor: bigint;
  description: string;
}): string {
  if (params.externalId) {
    return `${params.accountId}:${params.externalId}`;
  }

  const normalized = normalizeDescription(params.description);
  const input = [
    params.accountId,
    params.effectiveAt.toISOString(),
    params.amountMinor.toString(),
    normalized,
  ].join("|");

  return createHash("sha256").update(input).digest("hex");
}
