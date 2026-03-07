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

import { readFileSync, writeFileSync } from "node:fs";

type Args = {
  inPath: string;
  outPath: string;
};

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
    `Amex CSV -> event/leg CSV\n\nRequired:\n  --in <path>   Input Amex CSV\n  --out <path>  Output CSV`
  );
  process.exit(code);
}

/**
 * CSV parser that handles quoted fields with embedded newlines and commas.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;

    if (ch === "\n") {
      row.push(field);
      field = "";
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function csvEscape(v: string): string {
  if (/[,"\n\r]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

function amountToCents(amountStr: string): number {
  const s0 = amountStr.trim().replaceAll(",", "");
  const sign = s0.startsWith("-") ? -1 : 1;
  const s = s0.replace(/^[+-]/, "");
  const [dollarsRaw, centsRaw = ""] = s.split(".");
  const dollars = dollarsRaw.length ? parseInt(dollarsRaw, 10) : 0;
  const cents = parseInt((centsRaw + "00").slice(0, 2), 10);
  return sign * (dollars * 100 + cents);
}

function ddmmyyyyToIsoZ(dateStr: string): string {
  const m = dateStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`Invalid date: ${dateStr}`);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}T00:00:00Z`;
}

function stripSingleQuotes(v: string): string {
  return v.replace(/^'|'$/g, "").trim();
}

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
  const idxDateProcessed = col("Date Processed");
  const idxDescription = col("Description");
  const idxAmount = col("Amount");
  const idxReference = col("Reference");

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

    const line = [
      csvEscape(reference),
      csvEscape(reference),
      csvEscape(description),
      csvEscape(effectiveAt),
      csvEscape(postedAt),
      csvEscape(description),
      "AUD",
      String(cents),
    ].join(",");

    outLines.push(line);
  }

  writeFileSync(args.outPath, outLines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outLines.length - 1} rows to ${args.outPath}`);
}

main();
