import { createHash } from "node:crypto";

/**
 * Deterministic short hash of a row's identifying fields, used as a fallback
 * `externalEventId`/`eventGroup` for providers (or rows) with no natural ID.
 */
export function rowHash(parts: string[], length = 16): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, length);
}
