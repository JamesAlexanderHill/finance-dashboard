#!/usr/bin/env bun
/**
 * Amex PDF statement -> event/leg CSV
 *
 * Output columns:
 * externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount
 *
 * Usage:
 *   bun src/importers/amex-pdf-parser.ts --in .personal/raw/amex/*.pdf --out .personal/parsed/amex-pdf.csv
 *
 * Amex sign convention: positive (no "CR") = charge (outflow), "CR" = payment/credit (inflow).
 * Amounts are negated for charges so outflows are negative cents in the canonical format,
 * matching amex-parser.ts.
 *
 * Statement PDFs don't carry a transaction reference number, so externalEventId/eventGroup
 * are a deterministic hash of (date, description, amount), like vanguard-parser.ts.
 *
 * Input files must be named YYYY-MM-DD.pdf (statement closing date) - the year for each
 * transaction is inferred from this filename, since the statement period spans the prior
 * month (17th onward) through this date.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { csvEscape } from "./shared/csv";
import { rowHash } from "./shared/hash";

type Args = {
  inPaths: string[];
  outPath: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { inPaths: [], outPath: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) out.inPaths.push(argv[++i]);
    } else if (a === "--out" && argv[i + 1]) {
      out.outPath = argv[++i];
    } else if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    }
  }
  if (out.inPaths.length === 0 || !out.outPath) printHelpAndExit(1);
  return out;
}

function printHelpAndExit(code: number): never {
  console.error(
    `Amex PDF statement(s) -> event/leg CSV\n\nRequired:\n  --in <paths...>  Input statement PDF(s), named YYYY-MM-DD.pdf\n  --out <path>     Output CSV`
  );
  process.exit(code);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DATE_RE = /^([A-Za-z]+) (\d{1,2})$/;
const AMOUNT_RE = /^[\d,]+\.\d{2}$/;
const CLUSTER_GAP = 2.5;

// "Items in suspense" placeholder entries for a disputed charge: a debit is provisionally
// reversed out of the balance (SUSPENSION) and later reinstated (REV OF SUSPENSION) once
// the dispute is settled. These net to zero and aren't real balance movements - the actual
// resolution shows up separately as a CREDIT ADJUSTMENT / CREDIT FOR DISPUTED CHARGE, which
// we keep.
const SUSPENSE_DESCRIPTIONS = new Set(["SUSPENSION OF DISPUTED CHARGE", "REV OF SUSPENSION FOR DISPUTED CHARGE"]);

type PdfTextItem = { str: string; transform: number[] };

type Cluster = PdfTextItem[];

type Row = {
  effectiveAt: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // signed: negative = outflow, positive = inflow
};

/** Group text items into visual rows, chaining items whose y is within CLUSTER_GAP of the previous one. */
function clusterByY(items: PdfTextItem[]): Cluster[] {
  const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const clusters: Cluster[] = [];
  let current: Cluster = [];
  let lastY: number | null = null;
  for (const item of sorted) {
    const y = item.transform[5];
    if (lastY !== null && lastY - y > CLUSTER_GAP) {
      clusters.push(current);
      current = [];
    }
    current.push(item);
    lastY = y;
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

type TableHeader = { y: number; dateX: number; descX: number; foreignX: number; amountX: number };

/** Find the "TRANSACTION DATE / TRANSACTION DETAILS / FOREIGN SPEND / AMOUNT ($)" header row on a page, if present. */
function findTransactionHeader(items: PdfTextItem[]): TableHeader | null {
  const dateItem = items.find((it) => it.str.trim() === "TRANSACTION DATE");
  if (!dateItem) return null;
  const y = dateItem.transform[5];
  const sameRow = items.filter((it) => Math.abs(it.transform[5] - y) < 1);
  const find = (label: string) => sameRow.find((it) => it.str.trim() === label);
  const descItem = find("TRANSACTION DETAILS");
  const foreignItem = find("FOREIGN SPEND");
  const amountItem = find("AMOUNT ($)");
  if (!descItem || !foreignItem || !amountItem) return null;
  return {
    y,
    dateX: dateItem.transform[4],
    descX: descItem.transform[4],
    foreignX: foreignItem.transform[4],
    amountX: amountItem.transform[4],
  };
}

/** Parse the ACCOUNT SUMMARY box on page 1 for NEW CREDITS / NEW DEBITS totals, used to sanity-check the parse. */
function parseAccountSummary(items: PdfTextItem[]): { newCredits: number; newDebits: number } | null {
  const headerItem = items.find((it) => it.str.trim() === "NEW CREDITS");
  if (!headerItem) return null;
  const headerY = headerItem.transform[5];
  const numbers = items
    .filter((it) => it.transform[5] < headerY && it.transform[5] > headerY - 15 && AMOUNT_RE.test(it.str.trim()))
    .sort((a, b) => a.transform[4] - b.transform[4])
    .map((it) => parseFloat(it.str.trim().replace(/,/g, "")));
  if (numbers.length < 3) return null;
  return { newCredits: numbers[1], newDebits: numbers[2] };
}

async function extractRows(pdfPath: string): Promise<Row[]> {
  const filename = basename(pdfPath);
  const m = filename.match(/^(\d{4})-(\d{2})-\d{2}\.pdf$/);
  if (!m) throw new Error(`Filename must be YYYY-MM-DD.pdf (statement closing date), got: ${filename}`);
  const endYear = parseInt(m[1], 10);
  const endMonth = parseInt(m[2], 10);
  const startMonth = endMonth === 1 ? 12 : endMonth - 1;
  const startYear = endMonth === 1 ? endYear - 1 : endYear;

  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await getDocument({ data, verbosity: 0 }).promise;

  const rows: Row[] = [];
  let summary: { newCredits: number; newDebits: number } | null = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as PdfTextItem[];

    if (p === 1) summary = parseAccountSummary(items);

    const header = findTransactionHeader(items);
    if (!header) continue;

    const tableItems = items.filter((it) => it.str.trim() !== "" && it.transform[5] < header.y - 1);
    const clusters = clusterByY(tableItems);

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];

      const dateItem = cluster.find(
        (it) => Math.abs(it.transform[4] - header.dateX) < 6 && DATE_RE.test(it.str.trim())
      );
      if (!dateItem) continue;

      const [, monthName, dayStr] = dateItem.str.trim().match(DATE_RE)!;
      const monthNum = MONTHS.indexOf(monthName) + 1;
      if (monthNum === 0) continue;

      const amountCandidates = cluster
        .filter((it) => it.transform[4] > header.foreignX - 30 && AMOUNT_RE.test(it.str.trim()))
        .sort((a, b) => b.transform[4] - a.transform[4]);
      if (amountCandidates.length === 0) continue;
      const amount = parseFloat(amountCandidates[0].str.trim().replace(/,/g, ""));

      const descItems = cluster
        .filter(
          (it) =>
            it.transform[4] >= header.descX - 6 &&
            it.transform[4] < header.foreignX - 30 &&
            !AMOUNT_RE.test(it.str.trim())
        )
        .sort((a, b) => a.transform[4] - b.transform[4]);
      const description = descItems
        .map((it) => it.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!description) continue;
      if (SUSPENSE_DESCRIPTIONS.has(description.toUpperCase())) continue;

      // A "CR" on one of the following rows (which may be foreign-currency continuation
      // lines for this transaction) marks it as a payment/credit (inflow). Stop looking
      // once we reach the next dated transaction row.
      let isCredit = false;
      for (let j = i + 1; j < clusters.length; j++) {
        const next = clusters[j];
        const isNextTransaction = next.some(
          (it) => Math.abs(it.transform[4] - header.dateX) < 6 && DATE_RE.test(it.str.trim())
        );
        if (isNextTransaction) break;
        if (next.some((it) => it.str.trim() === "CR" && it.transform[4] > header.amountX - 20)) {
          isCredit = true;
          break;
        }
      }

      const year = monthNum === endMonth ? endYear : monthNum === startMonth ? startYear : endYear;
      const effectiveAt = `${year}-${String(monthNum).padStart(2, "0")}-${String(dayStr).padStart(2, "0")}`;
      const amountCents = Math.round(amount * 100);

      rows.push({ effectiveAt, description, amountCents: isCredit ? amountCents : -amountCents });
    }
  }

  if (summary) {
    const sumCredits = rows.filter((r) => r.amountCents > 0).reduce((a, r) => a + r.amountCents, 0) / 100;
    const sumDebits = rows.filter((r) => r.amountCents < 0).reduce((a, r) => a - r.amountCents, 0) / 100;
    if (Math.abs(sumCredits - summary.newCredits) > 0.01) {
      console.error(
        `${filename}: NEW CREDITS mismatch - statement says ${summary.newCredits.toFixed(2)}, parsed ${sumCredits.toFixed(2)}`
      );
    }
    if (Math.abs(sumDebits - summary.newDebits) > 0.01) {
      console.error(
        `${filename}: NEW DEBITS mismatch - statement says ${summary.newDebits.toFixed(2)}, parsed ${sumDebits.toFixed(2)}`
      );
    }
  } else {
    console.error(`${filename}: could not find ACCOUNT SUMMARY totals to validate against`);
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);

  const allRows: Row[] = [];
  for (const inPath of args.inPaths) {
    const rows = await extractRows(inPath);
    console.error(`${basename(inPath)}: parsed ${rows.length} transactions`);
    allRows.push(...rows);
  }

  allRows.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));

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

  const seen = new Map<string, number>();
  for (const row of allRows) {
    let id = rowHash([row.effectiveAt, row.description, String(row.amountCents)]);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = rowHash([id, String(count)]);

    const effectiveAtIso = `${row.effectiveAt}T00:00:00Z`;
    const line = [
      csvEscape(id),
      csvEscape(id),
      csvEscape(row.description),
      csvEscape(effectiveAtIso),
      csvEscape(effectiveAtIso),
      csvEscape(row.description),
      "AUD",
      String(row.amountCents),
    ].join(",");
    outLines.push(line);
  }

  writeFileSync(args.outPath, outLines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outLines.length - 1} rows to ${args.outPath}`);
}

main();
