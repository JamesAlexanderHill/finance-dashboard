#!/usr/bin/env bun
/**
 * Vanguard CSV -> event/leg CSV
 *
 * Output columns:
 * externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount
 *
 * Usage:
 *   bun src/importers/vanguard-parser.ts --in .personal/data/vanguard.csv --out .personal/parsed/vanguard-24-25.csv
 *
 * Row types:
 *   Deposit      → one leg: +total AUD (cents)
 *   Distribution → one leg: +total AUD (cents)
 *   Buy          → two legs: -(|total| cents) AUD  +  +(units × 100) in product ticker
 *
 * No ID column — externalEventId is a deterministic hash of the row content.
 * For Buy events the two legs share the same eventGroup (hash).
 */

import { readFileSync } from "node:fs";
import { parseInOutArgs } from "./shared/cli";
import { parseCsv } from "./shared/csv";
import { amountToCents } from "./shared/money";
import { rowHash } from "./shared/hash";
import { writeCanonicalCsv, type CanonicalLeg } from "./shared/canonical";

const MONTH: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "16-Apr-2025" -> "2025-04-16T00:00:00Z" */
function vanguardDateToIsoZ(s: string): string {
  const m = s.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) throw new Error(`Invalid Vanguard date: ${s}`);
  const [, dd, mon, yyyy] = m;
  const mm = MONTH[mon];
  if (!mm) throw new Error(`Unknown month: ${mon}`);
  return `${yyyy}-${mm}-${dd}T00:00:00Z`;
}

function main() {
  const args = parseInOutArgs(process.argv, "Vanguard");

  const rows = parseCsv(readFileSync(args.inPath, "utf8"));
  if (rows.length === 0) throw new Error("Input CSV is empty.");

  const header = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Missing column: ${name}`);
    return i;
  };

  const idxDate = col("Date");
  const idxType = col("Type");
  const idxProductName = col("Product Name");
  const idxProductId = col("Product ID");
  const idxUnits = col("Units");
  const idxTotal = col("Total");

  const legs: CanonicalLeg[] = [];

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    if (row.length < header.length) continue;

    const dateStr = (row[idxDate] ?? "").trim();
    const type = (row[idxType] ?? "").trim();
    const productName = (row[idxProductName] ?? "").trim();
    const productId = (row[idxProductId] ?? "").trim();
    const unitsStr = (row[idxUnits] ?? "").trim();
    const totalStr = (row[idxTotal] ?? "").trim();

    if (!dateStr || !type || !totalStr) continue;

    const effectiveAt = vanguardDateToIsoZ(dateStr);
    const totalCents = amountToCents(totalStr);
    const id = rowHash([dateStr, type, productName, productId, unitsStr, totalStr]);

    if (type === "Deposit") {
      legs.push({
        externalEventId: id,
        eventGroup: id,
        eventDescription: productName,
        effectiveAt,
        postedAt: effectiveAt,
        legDescription: productName,
        legTicker: "AUD",
        legUnitCount: totalCents,
      });
    } else if (type === "Distribution") {
      legs.push({
        externalEventId: id,
        eventGroup: id,
        eventDescription: `Distribution - ${productName}`,
        effectiveAt,
        postedAt: effectiveAt,
        legDescription: `Distribution - ${productName}`,
        legTicker: "AUD",
        legUnitCount: totalCents,
      });
    } else if (type === "Buy") {
      const units = parseFloat(unitsStr);
      if (isNaN(units) || !productId) {
        console.error(`Row ${r + 2}: Buy missing units or product ID, skipping.`);
        continue;
      }
      const description = `Buy ${units} ${productId} - ${productName}`;
      // AUD leg: totalCents is already negative (cost)
      legs.push({
        externalEventId: id,
        eventGroup: id,
        eventDescription: description,
        effectiveAt,
        postedAt: effectiveAt,
        legDescription: description,
        legTicker: "AUD",
        legUnitCount: totalCents,
      });
      // ETF leg: whole units (exponent 0 — shares are not subdivided)
      legs.push({
        externalEventId: id,
        eventGroup: id,
        eventDescription: description,
        effectiveAt,
        postedAt: effectiveAt,
        legDescription: description,
        legTicker: productId,
        legUnitCount: Math.round(units),
      });
    } else {
      console.error(`Row ${r + 2}: Unknown type "${type}", skipping.`);
    }
  }

  writeCanonicalCsv(args.outPath, legs);
  console.log(`Wrote ${legs.length} rows to ${args.outPath}`);
}

main();
