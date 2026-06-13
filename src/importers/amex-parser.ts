#!/usr/bin/env bun
/**
 * Amex CSV -> event/leg CSV
 *
 * Output columns:
 * externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount
 *
 * Usage:
 *   bun src/importers/amex-parser.ts --in .personal/data/amex.csv --out .personal/parsed/amex-24-25.csv
 *
 * Amex sign convention: positive = charge (outflow), negative = payment/credit (inflow).
 * Amounts are negated so outflows are negative cents in the canonical format.
 */

import { readFileSync } from "node:fs";
import { parseInOutArgs } from "./shared/cli";
import { parseCsv } from "./shared/csv";
import { amountToCents } from "./shared/money";
import { ddmmyyyyToIsoZ } from "./shared/dates";
import { writeCanonicalCsv, type CanonicalLeg } from "./shared/canonical";

function stripSingleQuotes(v: string): string {
  return v.replace(/^'|'$/g, "").trim();
}

function main() {
  const args = parseInOutArgs(process.argv, "Amex");

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
  const idxDateProcessed = col("Date Processed");
  const idxDescription = col("Description");
  const idxAmount = col("Amount");
  const idxReference = col("Reference");

  const legs: CanonicalLeg[] = [];

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    if (row.length < header.length) continue;

    const dateStr = (row[idxDate] ?? "").trim();
    const dateProcessedStr = (row[idxDateProcessed] ?? "").trim();
    const description = (row[idxDescription] ?? "").trim();
    const amountStr = (row[idxAmount] ?? "").trim();
    const referenceRaw = (row[idxReference] ?? "").trim();

    if (!dateStr || !amountStr || !description) continue;

    const reference = stripSingleQuotes(referenceRaw);
    if (!reference) {
      console.error(`Row ${r + 2}: missing Reference, skipping.`);
      continue;
    }

    const effectiveAt = ddmmyyyyToIsoZ(dateStr);
    const postedAt = ddmmyyyyToIsoZ(dateProcessedStr || dateStr);

    // Amex: positive = charge (outflow) → negate to negative cents
    const cents = -amountToCents(amountStr);

    legs.push({
      externalEventId: reference,
      eventGroup: reference,
      eventDescription: description,
      effectiveAt,
      postedAt,
      legDescription: description,
      legTicker: "AUD",
      legUnitCount: cents,
    });
  }

  writeCanonicalCsv(args.outPath, legs);
  console.log(`Wrote ${legs.length} rows to ${args.outPath}`);
}

main();
