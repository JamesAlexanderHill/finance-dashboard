#!/usr/bin/env bun
/**
 * Wise CSV -> event/leg CSV
 *
 * Output columns:
 * externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount
 *
 * Usage:
 *   bun src/importers/wise-parser.ts --in .personal/data/wise.csv --out .personal/parsed/wise-24-25.csv
 *
 * Sign convention:
 *   OUT  → negative leg in source currency (outflow)
 *   IN   → positive leg in target currency (inflow)
 *   NEUTRAL → two legs: negative source currency + positive target currency (FX conversion)
 *
 * Rows with the same ID are grouped into one event (handles cross-currency card transactions
 * that appear as multiple rows with the same ID).
 *
 * CANCELLED transactions are skipped.
 */

import { readFileSync } from "node:fs";
import { parseInOutArgs } from "./shared/cli";
import { parseCsv } from "./shared/csv";
import { amountToCents } from "./shared/money";
import { writeCanonicalCsv, type CanonicalLeg } from "./shared/canonical";

/** "2025-06-19 21:28:31" -> "2025-06-19T21:28:31Z" */
function wiseDateToIsoZ(s: string): string {
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) throw new Error(`Invalid Wise date: ${s}`);
  return `${m[1]}T${m[2]}Z`;
}

function main() {
  const args = parseInOutArgs(process.argv, "Wise");

  const rows = parseCsv(readFileSync(args.inPath, "utf8"));
  if (rows.length === 0) throw new Error("Input CSV is empty.");

  const header = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Missing column: ${name}`);
    return i;
  };

  const idxId = col("ID");
  const idxStatus = col("Status");
  const idxDirection = col("Direction");
  const idxCreatedOn = col("Created on");
  const idxFinishedOn = col("Finished on");
  const idxSourceAmount = col("Source amount (after fees)");
  const idxSourceCurrency = col("Source currency");
  const idxTargetName = col("Target name");
  const idxTargetAmount = col("Target amount (after fees)");
  const idxTargetCurrency = col("Target currency");

  // Group rows by ID to build events (same ID = same event group)
  const grouped = new Map<string, { rows: string[][]; direction: string; createdOn: string; finishedOn: string }>();

  for (const row of dataRows) {
    const status = (row[idxStatus] ?? "").trim();
    if (status === "CANCELLED") continue;

    const id = (row[idxId] ?? "").trim();
    if (!id) continue;

    const direction = (row[idxDirection] ?? "").trim();
    const createdOn = (row[idxCreatedOn] ?? "").trim();
    const finishedOn = (row[idxFinishedOn] ?? "").trim();

    if (!grouped.has(id)) {
      grouped.set(id, { rows: [], direction, createdOn, finishedOn });
    }
    grouped.get(id)!.rows.push(row);
  }

  const legs: CanonicalLeg[] = [];

  for (const [id, group] of grouped) {
    const { direction, createdOn, finishedOn } = group;

    const effectiveAt = wiseDateToIsoZ(createdOn);
    const postedAt = wiseDateToIsoZ(finishedOn || createdOn);

    // Event description: use target name from first row (merchant name for OUT)
    const firstRow = group.rows[0];
    const targetName = (firstRow[idxTargetName] ?? "").trim();
    const eventDescription =
      direction === "NEUTRAL"
        ? `Currency exchange ${(firstRow[idxSourceCurrency] ?? "").trim()} → ${(firstRow[idxTargetCurrency] ?? "").trim()}`
        : targetName || id;

    if (direction === "NEUTRAL") {
      // One NEUTRAL row = two legs: debit source, credit target
      for (const row of group.rows) {
        const sourceCurrency = (row[idxSourceCurrency] ?? "").trim();
        const targetCurrency = (row[idxTargetCurrency] ?? "").trim();
        const sourceAmount = amountToCents((row[idxSourceAmount] ?? "").trim());
        const targetAmount = amountToCents((row[idxTargetAmount] ?? "").trim());

        legs.push({
          externalEventId: id,
          eventGroup: id,
          eventDescription,
          effectiveAt,
          postedAt,
          legDescription: `Sold ${sourceCurrency}`,
          legTicker: sourceCurrency,
          legUnitCount: -sourceAmount,
        });
        legs.push({
          externalEventId: id,
          eventGroup: id,
          eventDescription,
          effectiveAt,
          postedAt,
          legDescription: `Bought ${targetCurrency}`,
          legTicker: targetCurrency,
          legUnitCount: targetAmount,
        });
      }
    } else {
      // OUT or IN: one leg per row
      for (const row of group.rows) {
        const sourceCurrency = (row[idxSourceCurrency] ?? "").trim();
        const targetCurrency = (row[idxTargetCurrency] ?? "").trim();
        const sourceAmount = amountToCents((row[idxSourceAmount] ?? "").trim());
        const targetAmount = amountToCents((row[idxTargetAmount] ?? "").trim());
        const legTargetName = (row[idxTargetName] ?? "").trim();

        if (direction === "OUT") {
          legs.push({
            externalEventId: id,
            eventGroup: id,
            eventDescription,
            effectiveAt,
            postedAt,
            legDescription: legTargetName || eventDescription,
            legTicker: sourceCurrency,
            legUnitCount: -sourceAmount,
          });
        } else {
          // IN
          legs.push({
            externalEventId: id,
            eventGroup: id,
            eventDescription,
            effectiveAt,
            postedAt,
            legDescription: legTargetName || eventDescription,
            legTicker: targetCurrency,
            legUnitCount: targetAmount,
          });
        }
      }
    }
  }

  writeCanonicalCsv(args.outPath, legs);
  console.log(`Wrote ${legs.length} rows to ${args.outPath}`);
}

main();
