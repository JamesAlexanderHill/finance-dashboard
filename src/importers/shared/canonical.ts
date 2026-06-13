import { writeFileSync } from "node:fs";
import { csvEscape } from "./csv";

/**
 * Canonical CSV columns produced by every importer parser and consumed by
 * `src/importers/canonical.ts` (`parseCanonicalCsv`).
 */
export const CANONICAL_HEADER = [
  "externalEventId",
  "eventGroup",
  "eventDescription",
  "effectiveAt",
  "postedAt",
  "legDescription",
  "legTicker",
  "legUnitCount",
] as const;

export type CanonicalLeg = {
  externalEventId: string;
  eventGroup: string;
  eventDescription: string;
  effectiveAt: string;
  postedAt: string;
  legDescription: string;
  legTicker: string;
  legUnitCount: number;
};

export function formatCanonicalRow(leg: CanonicalLeg): string {
  return [
    csvEscape(leg.externalEventId),
    csvEscape(leg.eventGroup),
    csvEscape(leg.eventDescription),
    csvEscape(leg.effectiveAt),
    csvEscape(leg.postedAt),
    csvEscape(leg.legDescription),
    csvEscape(leg.legTicker),
    String(leg.legUnitCount),
  ].join(",");
}

/** Writes canonical-format CSV legs to `outPath`, including the header row. */
export function writeCanonicalCsv(outPath: string, legs: CanonicalLeg[]): void {
  const outLines = [CANONICAL_HEADER.join(","), ...legs.map(formatCanonicalRow)];
  writeFileSync(outPath, outLines.join("\n") + "\n", "utf8");
}
