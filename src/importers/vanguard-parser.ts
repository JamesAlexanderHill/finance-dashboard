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

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
    `Vanguard CSV -> event/leg CSV\n\nRequired:\n  --in <path>   Input Vanguard CSV\n  --out <path>  Output CSV`
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

function rowHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 16);
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

  const idxDate = col("Date");
  const idxType = col("Type");
  const idxProductName = col("Product Name");
  const idxProductId = col("Product ID");
  const idxUnits = col("Units");
  const idxTotal = col("Total");

  const legs: Leg[] = [];

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
      // ETF leg: units × 100 (minor units = 1/100th of a share)
      legs.push({
        externalEventId: id,
        eventGroup: id,
        eventDescription: description,
        effectiveAt,
        postedAt: effectiveAt,
        legDescription: description,
        legTicker: productId,
        legUnitCount: Math.round(units * 100),
      });
    } else {
      console.error(`Row ${r + 2}: Unknown type "${type}", skipping.`);
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
