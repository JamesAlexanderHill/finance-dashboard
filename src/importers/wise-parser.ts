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

import { readFileSync, writeFileSync } from "node:fs";

type Args = { inPath: string; outPath: string };

function parseArgs(argv: string[]): Args {
  const out: Args = { inPath: "", outPath: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in" && argv[i + 1]) out.inPath = argv[++i];
    else if (a === "--out" && argv[i + 1]) out.outPath = argv[++i];
    else if (a === "--help" || a === "-h") printHelpAndExit(0);
  }
  if (!out.inPath || !out.outPath) printHelpAndExit(1);
  return out;
}

function printHelpAndExit(code: number): never {
  console.error(
    `Wise CSV -> event/leg CSV\n\nRequired:\n  --in <path>   Input Wise CSV\n  --out <path>  Output CSV`
  );
  process.exit(code);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field); field = "";
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function csvEscape(v: string): string {
  if (/[,"\n\r]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

function amountToCents(s: string): number {
  const s0 = s.trim().replaceAll(",", "");
  if (!s0 || isNaN(Number(s0))) return 0;
  const sign = s0.startsWith("-") ? -1 : 1;
  const abs = s0.replace(/^[+-]/, "");
  const [dollarsRaw, centsRaw = ""] = abs.split(".");
  const dollars = dollarsRaw.length ? parseInt(dollarsRaw, 10) : 0;
  const cents = parseInt((centsRaw + "00").slice(0, 2), 10);
  return sign * (dollars * 100 + cents);
}

/** "2025-06-19 21:28:31" -> "2025-06-19T21:28:31Z" */
function wiseDateToIsoZ(s: string): string {
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) throw new Error(`Invalid Wise date: ${s}`);
  return `${m[1]}T${m[2]}Z`;
}

type Leg = {
  externalEventId: string;
  eventGroup: string;
  eventDescription: string;
  effectiveAt: string;
  postedAt: string;
  legDescription: string;
  legTicker: string;
  legUnitCount: number;
};

function main() {
  const args = parseArgs(process.argv);

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

  const legs: Leg[] = [];

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

  const outHeader = [
    "externalEventId",
    "eventGroup",
    "eventDescription",
    "effectiveAt",
    "postedAt",
    "legDescription",
    "legTicker",
    "legUnitCount",
  ];

  const outLines: string[] = [outHeader.join(",")];
  for (const l of legs) {
    outLines.push([
      csvEscape(l.externalEventId),
      csvEscape(l.eventGroup),
      csvEscape(l.eventDescription),
      csvEscape(l.effectiveAt),
      csvEscape(l.postedAt),
      csvEscape(l.legDescription),
      csvEscape(l.legTicker),
      String(l.legUnitCount),
    ].join(","));
  }

  writeFileSync(args.outPath, outLines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outLines.length - 1} rows to ${args.outPath}`);
}

main();
