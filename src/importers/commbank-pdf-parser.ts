#!/usr/bin/env bun
/**
 * CommBank PDF statement -> event/leg CSV
 *
 * Output columns:
 * externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount
 *
 * Usage:
 *   bun src/importers/commbank-pdf-parser.ts --in .personal/raw/commbank/*.pdf --out .personal/parsed/commbank-pdf.csv
 *
 * CommBank sign convention: amounts in the "Debit" column are outflows (negative cents),
 * amounts in the "Credit" column are inflows (positive cents), matching commbank-parser.ts.
 *
 * Statement PDFs don't carry a transaction reference number, so externalEventId/eventGroup
 * are a deterministic hash of (date, description, amount), like amex-pdf-parser.ts.
 *
 * The transaction year isn't printed next to each row (just "DD Mon") - it's derived from
 * the "DD Mon YYYY OPENING BALANCE" row at the top of the statement, then tracked forward,
 * incrementing on each Dec -> Jan rollover.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { rowHash } from "./shared/hash";
import { writeCanonicalCsv, type CanonicalLeg } from "./shared/canonical";

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
    `CommBank PDF statement(s) -> event/leg CSV\n\nRequired:\n  --in <paths...>  Input statement PDF(s)\n  --out <path>     Output CSV`
  );
  process.exit(code);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const AMOUNT_RE = /^[\d,]+\.\d{2}$/;
// "DD Mon description" - date and description combined in a single text item.
const TXN_START_RE = /^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (.+)$/;
// "DD Mon" - date alone; the description is a separate item later in the same row.
const DATE_ONLY_RE = /^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/;
const BALANCE_ROW_RE = /^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (OPENING|CLOSING) BALANCE$/;
const CLUSTER_GAP = 1;

// Description text lives in the Date/Transaction columns (x < ~90), with nothing
// else until the Debit column - so anything left of this is description text.
const DESC_X_MAX = 300;
// Debit/Credit amounts: right-aligned, so wider numbers start further left of the
// column header's x. The running-balance column starts well to the right of this.
const AMOUNT_X_MIN = 300;
const AMOUNT_X_MAX_PAD = 20;

type PdfTextItem = { str: string; transform: number[] };

type Cluster = PdfTextItem[];

type Row = {
  effectiveAt: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // signed: negative = outflow (debit), positive = inflow (credit)
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

type TableHeader = { y: number; dateX: number; descX: number; debitX: number; creditX: number; balanceX: number };

/** Find the "Date / Transaction / Debit / Credit / Balance" header row on a page, if present. */
function findTransactionHeader(items: PdfTextItem[]): TableHeader | null {
  const dateItem = items.find((it) => it.str.trim() === "Date");
  if (!dateItem) return null;
  const y = dateItem.transform[5];
  const sameRow = items.filter((it) => Math.abs(it.transform[5] - y) < 1);
  const find = (label: string) => sameRow.find((it) => it.str.trim() === label);
  const descItem = find("Transaction");
  const debitItem = find("Debit");
  const creditItem = find("Credit");
  const balanceItem = find("Balance");
  if (!descItem || !debitItem || !creditItem || !balanceItem) return null;
  return {
    y,
    dateX: dateItem.transform[4],
    descX: descItem.transform[4],
    debitX: debitItem.transform[4],
    creditX: creditItem.transform[4],
    balanceX: balanceItem.transform[4],
  };
}

/** Parse a "...$X,XXX.XX CR/DR" or "...Nil" balance from a row's concatenated text. */
function parseBalance(rowText: string): number | null {
  const m = rowText.match(/\$?([\d,]+\.\d{2})\s*(CR|DR)?/);
  if (m) {
    const amount = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
    return m[2] === "DR" ? -amount : amount;
  }
  if (/\bNil\b/.test(rowText)) return 0;
  return null;
}

async function extractRows(data: Uint8Array, filename: string): Promise<Row[]> {
  const doc = await getDocument({ data, verbosity: 0 }).promise;

  const rows: Row[] = [];

  let year: number | null = null;
  let monthIdx: number | null = null;
  let openingBalanceCents: number | null = null;
  let closingBalanceCents: number | null = null;

  let current: Row | null = null;
  let currentAmounts: number[] = [];

  function finalizeCurrent() {
    if (!current) return;
    if (currentAmounts.length === 1) {
      current.amountCents = currentAmounts[0];
    } else if (currentAmounts.length === 0) {
      console.error(`${filename}: no amount found for "${current.description}" on ${current.effectiveAt}, dropping`);
      current = null;
    } else {
      console.error(
        `${filename}: multiple amounts found for "${current.description}" on ${current.effectiveAt}, summing them`
      );
      current.amountCents = currentAmounts.reduce((a, b) => a + b, 0);
    }
    if (current) rows.push(current);
    current = null;
    currentAmounts = [];
  }

  let done = false;
  for (let p = 1; p <= doc.numPages && !done; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as PdfTextItem[];

    const header = findTransactionHeader(items);
    if (!header) continue;

    const tableItems = items.filter((it) => it.str.trim() !== "" && it.transform[5] < header.y - 1);
    const clusters = clusterByY(tableItems);
    const midX = (header.debitX + header.creditX) / 2;
    const amountXMax = header.creditX + AMOUNT_X_MAX_PAD;

    for (const cluster of clusters) {
      const sorted = [...cluster].sort((a, b) => a.transform[4] - b.transform[4]);
      const rowText = sorted.map((it) => it.str).join(" ");

      const balanceItem = sorted.find((it) => BALANCE_ROW_RE.test(it.str.trim()));
      if (balanceItem) {
        const [, , , yearStr, kind] = balanceItem.str.trim().match(BALANCE_ROW_RE)!;
        const balance = parseBalance(rowText);
        if (kind === "OPENING") {
          year = parseInt(yearStr, 10);
          monthIdx = MONTHS.indexOf(balanceItem.str.trim().match(BALANCE_ROW_RE)![2]);
          openingBalanceCents = balance;
        } else {
          finalizeCurrent();
          closingBalanceCents = balance;
          done = true;
          break;
        }
        continue;
      }

      const descItems = sorted.filter(
        (it) => it.transform[4] > header.dateX - 5 && it.transform[4] < DESC_X_MAX && it.str.trim() !== ""
      );
      const dateItem = descItems.find(
        (it) => Math.abs(it.transform[4] - header.dateX) < 6 && (TXN_START_RE.test(it.str.trim()) || DATE_ONLY_RE.test(it.str.trim()))
      );

      if (dateItem) {
        finalizeCurrent();

        const trimmed = dateItem.str.trim();
        const startMatch = trimmed.match(TXN_START_RE);
        let dayStr: string;
        let monthAbbr: string;
        let descStart: string;
        if (startMatch) {
          [, dayStr, monthAbbr, descStart] = startMatch;
        } else {
          [, dayStr, monthAbbr] = trimmed.match(DATE_ONLY_RE)!;
          descStart = "";
        }

        const newMonthIdx = MONTHS.indexOf(monthAbbr);
        if (year === null || monthIdx === null) {
          throw new Error(`${filename}: transaction row before OPENING BALANCE row`);
        }
        if (newMonthIdx < monthIdx) year++;
        monthIdx = newMonthIdx;

        const otherDescText = descItems
          .filter((it) => it !== dateItem)
          .map((it) => it.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        const effectiveAt = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${dayStr}`;
        const description = [descStart.trim(), otherDescText].filter(Boolean).join(" ").trim();
        current = { effectiveAt, description, amountCents: 0 };
      } else if (current && descItems.length > 0) {
        // Continuation line (card number, value date, reference, etc.) for the current transaction.
        const text = descItems
          .map((it) => it.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) current.description = `${current.description} ${text}`.trim();
      }

      // Any row (start or continuation) may carry the transaction's Debit/Credit amount.
      if (current) {
        for (const it of sorted) {
          const x = it.transform[4];
          const str = it.str.trim();
          if (x < AMOUNT_X_MIN || x > amountXMax || !AMOUNT_RE.test(str)) continue;
          const amount = Math.round(parseFloat(str.replace(/,/g, "")) * 100);
          currentAmounts.push(x < midX ? -amount : amount);
        }
      }
    }
  }
  finalizeCurrent();

  if (openingBalanceCents !== null && closingBalanceCents !== null) {
    const sum = rows.reduce((a, r) => a + r.amountCents, 0);
    if (openingBalanceCents + sum !== closingBalanceCents) {
      console.error(
        `${filename}: balance mismatch - opening ${openingBalanceCents} + transactions ${sum} = ${
          openingBalanceCents + sum
        }, but closing balance is ${closingBalanceCents}`
      );
    }
  } else {
    console.error(`${filename}: could not find OPENING/CLOSING BALANCE to validate against`);
  }

  return rows;
}

/** Parses one or more CommBank statement PDFs into canonical legs. */
export async function parseCommbankPdf(
  files: { data: Uint8Array; filename: string }[],
): Promise<CanonicalLeg[]> {
  const allRows: Row[] = [];
  for (const file of files) {
    const rows = await extractRows(file.data, file.filename);
    console.error(`${file.filename}: parsed ${rows.length} transactions`);
    allRows.push(...rows);
  }

  allRows.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));

  const legs: CanonicalLeg[] = [];
  const seen = new Map<string, number>();
  for (const row of allRows) {
    let id = rowHash([row.effectiveAt, row.description, String(row.amountCents)]);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = rowHash([id, String(count)]);

    const effectiveAtIso = `${row.effectiveAt}T00:00:00Z`;
    legs.push({
      externalEventId: id,
      eventGroup: id,
      eventDescription: row.description,
      effectiveAt: effectiveAtIso,
      postedAt: effectiveAtIso,
      legDescription: row.description,
      legTicker: "AUD",
      legUnitCount: row.amountCents,
    });
  }

  return legs;
}

async function main() {
  const args = parseArgs(process.argv);
  const files = args.inPaths.map((p) => ({ data: new Uint8Array(readFileSync(p)), filename: basename(p) }));
  const legs = await parseCommbankPdf(files);
  writeCanonicalCsv(args.outPath, legs);
  console.log(`Wrote ${legs.length} rows to ${args.outPath}`);
}

if (import.meta.main) {
  main();
}
