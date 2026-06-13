#!/usr/bin/env bun
/**
 * Commbank CSV -> event/leg CSV
 *
 * Output columns:
 * externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount
 *
 * Usage:
 *   bun commbank-to-eventlegs.ts --in commbank.csv --out out.csv
 *
 * If your input has headers:
 *   bun commbank-to-eventlegs.ts --in commbank.csv --out out.csv --has-header
 *
 * If your reference column has a different name:
 *   bun commbank-to-eventlegs.ts --in commbank.csv --out out.csv --has-header --ref-col "Reference"
 *
 * If there is NO reference column and you want a deterministic fallback:
 *   bun commbank-to-eventlegs.ts --in commbank.csv --out out.csv --allow-fallback-ids
 */

import { readFileSync } from "node:fs";
import { parseCsv } from "./shared/csv";
import { amountToCents } from "./shared/money";
import { ddmmyyyyToIsoZ } from "./shared/dates";
import { rowHash } from "./shared/hash";
import { writeCanonicalCsv, type CanonicalLeg } from "./shared/canonical";

type Args = {
  inPath: string;
  outPath: string;
  hasHeader: boolean;
  refCol: string; // used when hasHeader=true
  allowFallbackIds: boolean;
};

const DEFAULT_REF_COL_CANDIDATES = [
  "Reference",
  "reference",
  "Transaction reference",
  "Transaction Reference",
  "Ref",
  "ref",
  "Receipt number",
  "Receipt Number",
];

function parseArgs(argv: string[]): Args {
  const out: Args = {
    inPath: "",
    outPath: "",
    hasHeader: false,
    refCol: "Reference",
    allowFallbackIds: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in" && argv[i + 1]) out.inPath = argv[++i];
    else if (a === "--out" && argv[i + 1]) out.outPath = argv[++i];
    else if (a === "--has-header") out.hasHeader = true;
    else if (a === "--ref-col" && argv[i + 1]) out.refCol = argv[++i];
    else if (a === "--allow-fallback-ids") out.allowFallbackIds = true;
    else if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    } else {
      // ignore unknown flags to keep it simple
    }
  }

  if (!out.inPath || !out.outPath) {
    printHelpAndExit(1);
  }
  return out;
}

function printHelpAndExit(code: number): never {
  const msg = `
Commbank CSV -> event/leg CSV (Bun)

Required:
  --in <path>     Input Commbank CSV
  --out <path>    Output CSV

Optional:
  --has-header              Treat first row as header
  --ref-col "<name>"        Reference column name (only used with --has-header)
  --allow-fallback-ids      If no reference column exists, generate deterministic IDs

Examples:
  bun commbank-to-eventlegs.ts --in commbank.csv --out out.csv
  bun commbank-to-eventlegs.ts --in commbank.csv --out out.csv --has-header --ref-col "Reference"
`.trim();
  console.error(msg);
  process.exit(code);
}

function stableFallbackId(parts: string[]): string {
  return `cba-${rowHash(parts, 16)}`;
}

function main() {
  const args = parseArgs(process.argv);

  const inputText = readFileSync(args.inPath, "utf8");
  const rows = parseCsv(inputText);

  if (rows.length === 0) {
    throw new Error("Input CSV is empty.");
  }

  // If there's no header, default Commbank export shape often is:
  // Date, Amount, Description, Balance
  // But your requirement says we MUST use a reference column for externalEventId.
  // So:
  // - If --has-header: we find ref/date/amount/description by column name
  // - Else: we *require* a 5th column (reference), or we fail unless fallback enabled.
  let header: string[] | null = null;
  let dataRows = rows;

  if (args.hasHeader) {
    header = rows[0].map((h) => h.trim());
    dataRows = rows.slice(1);
  }

  // Column indices
  let idxRef = -1;
  let idxDate = -1;
  let idxAmount = -1;
  let idxDesc = -1;

  if (header) {
    // Reference
    const preferred = args.refCol.trim();
    idxRef = header.findIndex((h) => h === preferred);
    if (idxRef === -1) {
      for (const cand of DEFAULT_REF_COL_CANDIDATES) {
        idxRef = header.findIndex((h) => h === cand);
        if (idxRef !== -1) break;
      }
    }

    // Date / Amount / Description (try common names)
    const dateCandidates = ["Date", "date", "Transaction date", "Transaction Date"];
    const amountCandidates = ["Amount", "amount", "Debit", "Credit", "Value", "value"];
    const descCandidates = ["Description", "description", "Narration", "narration", "Details", "details"];

    idxDate = dateCandidates.map((c) => header!.findIndex((h) => h === c)).find((i) => i !== -1) ?? -1;
    idxAmount = amountCandidates.map((c) => header!.findIndex((h) => h === c)).find((i) => i !== -1) ?? -1;
    idxDesc = descCandidates.map((c) => header!.findIndex((h) => h === c)).find((i) => i !== -1) ?? -1;

    if (idxDate === -1 || idxAmount === -1 || idxDesc === -1) {
      throw new Error(
        `Could not find required columns. Found header: [${header.join(", ")}]. ` +
          `Need at least Date/Amount/Description (names can vary).`
      );
    }
  } else {
    // No header: require at least [Date, Amount, Description, Reference] OR fallback
    // Common 4-col export is Date, Amount, Description, Balance (NO reference).
    // To honor your requirement: externalEventId must be reference => fail unless fallback enabled.
    const minCols = Math.max(...dataRows.map((r) => r.length));
    const looksLike4Cols = minCols >= 4 && dataRows.every((r) => r.length >= 3);

    if (looksLike4Cols && !args.allowFallbackIds) {
      throw new Error(
        "Input CSV has no header and looks like a 4-column Commbank export (Date, Amount, Description, Balance) " +
          "with no reference column. Your requirement says externalEventId must come from the Commbank reference column.\n\n" +
          "Options:\n" +
          "  1) Export the Commbank CSV that includes a Reference column and re-run with --has-header\n" +
          "  2) Re-run with --allow-fallback-ids to generate deterministic IDs\n"
      );
    }

    // Interpret as:
    // Date, Amount, Description, Reference (if present)
    // If 4 columns but it's actually balance, fallback mode will hash and ignore last column anyway.
    idxDate = 0;
    idxAmount = 1;
    idxDesc = 2;
    idxRef = 3; // if present; otherwise fallback
  }

  // Build legs, group by eventGroup (== reference or fallback id)
  const legs: CanonicalLeg[] = [];

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    if (row.length === 0) continue;

    const dateStr = (row[idxDate] ?? "").trim();
    const amountStr = (row[idxAmount] ?? "").trim();
    const desc = (row[idxDesc] ?? "").trim();

    if (!dateStr || !amountStr || !desc) continue;

    const effectiveAt = ddmmyyyyToIsoZ(dateStr);
    const postedAt = effectiveAt;

    let ref = "";
    if (idxRef !== -1) ref = (row[idxRef] ?? "").trim();

    if (!ref) {
      if (!args.allowFallbackIds) {
        throw new Error(
          `Missing reference value on row ${args.hasHeader ? r + 2 : r + 1}. ` +
            `Re-export with a Reference column or use --allow-fallback-ids.`
        );
      }
      // fallback id uses date+amount+desc+rowIndex to reduce collisions
      ref = stableFallbackId([dateStr, amountStr, desc, String(r)]);
    }

    const cents = amountToCents(amountStr);

    legs.push({
      externalEventId: ref,
      eventGroup: ref,
      eventDescription: "", // set per group below
      effectiveAt,
      postedAt,
      legDescription: desc,
      legTicker: "AUD",
      legUnitCount: cents,
    });
  }

  // Set eventDescription per group to the first leg description in that group
  const groupToEventDesc = new Map<string, string>();
  for (const l of legs) {
    if (!groupToEventDesc.has(l.eventGroup)) groupToEventDesc.set(l.eventGroup, l.legDescription);
  }
  for (const l of legs) {
    l.eventDescription = groupToEventDesc.get(l.eventGroup) ?? l.legDescription;
  }

  writeCanonicalCsv(args.outPath, legs);
}

main();
