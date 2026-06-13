#!/usr/bin/env bun
/**
 * Vanguard Personal Investor quarterly statement PDF -> event/leg CSV
 *
 * Output columns:
 * externalEventId,eventGroup,eventDescription,effectiveAt,postedAt,legDescription,legTicker,legUnitCount
 *
 * Usage:
 *   bun src/importers/vanguard-pdf-parser.ts --in .personal/raw/vanguard/*.pdf --out .personal/parsed/vanguard-pdf.csv
 *
 * Each statement has two tables:
 *  - "Your Vanguard Cash Account transaction details" - deposits, withdrawals and
 *    distributions (DIV: ...) become a single AUD leg each. "Buy/Sell transaction
 *    of X" rows are skipped here (they're emitted from the investment table below)
 *    but still counted towards the opening/closing balance validation.
 *  - "Your investment transaction details" - Buy/Sell trades become a 2-leg event:
 *    an AUD leg (the cash side, negative for Buy / positive for Sell) and an ETF
 *    leg (whole units, positive for Buy / negative for Sell). Only present in
 *    statements with at least one trade.
 *
 * Row text wraps across multiple PDF text items/lines (e.g. a long deposit
 * description, or a trade's investment product name) - rows are grouped into
 * "blocks" by y-proximity (gap <= BLOCK_GAP), then each column is read from the
 * items in that block at the matching x position.
 *
 * No ID column - externalEventId is a deterministic hash of the row content, with
 * a seen-count collision suffix.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
    `Vanguard statement PDF(s) -> event/leg CSV\n\nRequired:\n  --in <paths...>  Input statement PDF(s)\n  --out <path>     Output CSV`
  );
  process.exit(code);
}

function csvEscape(v: string): string {
  if (/[,"\n\r]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

const MONTH: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

const AMOUNT_RE = /^[\d,]+\.\d{2}$/;
const DATE_RE = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;
const BLOCK_GAP = 10;

function dateToIsoZ(s: string): string {
  const m = s.match(DATE_RE);
  if (!m) throw new Error(`Invalid date: ${s}`);
  const [, dd, mon, yyyy] = m;
  const mm = MONTH[mon];
  if (!mm) throw new Error(`Unknown month: ${mon}`);
  return `${yyyy}-${mm}-${dd.padStart(2, "0")}T00:00:00Z`;
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

function rowHash(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 16);
}

type PdfTextItem = { str: string; transform: number[] };
type Block = PdfTextItem[];

type CashLeg = {
  effectiveAt: string;
  description: string;
  amountCents: number;
};

type TradeLeg = {
  effectiveAt: string;
  description: string;
  ticker: string;
  audDelta: number;
  etfDelta: number;
};

/** Group items into visual row-blocks: a new block starts when the y-gap from the previous item exceeds BLOCK_GAP. */
function blockify(items: PdfTextItem[]): Block[] {
  const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const blocks: Block[] = [];
  let current: Block = [];
  let lastY: number | null = null;
  for (const item of sorted) {
    const y = item.transform[5];
    if (lastY !== null && lastY - y > BLOCK_GAP) {
      blocks.push(current);
      current = [];
    }
    current.push(item);
    lastY = y;
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function textAtX(block: Block, x: number, tolerance: number): string {
  return block
    .filter((it) => Math.abs(it.transform[4] - x) < tolerance && it.str.trim() !== "")
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function amountAtXRange(block: Block, xMin: number, xMax: number): PdfTextItem | undefined {
  return block.find((it) => {
    const x = it.transform[4];
    return x >= xMin && x <= xMax && AMOUNT_RE.test(it.str.trim());
  });
}

type CashHeader = { y: number; dateX: number; descX: number; debitX: number; creditX: number; balanceX: number };

function findCashHeader(items: PdfTextItem[]): CashHeader | null {
  const dateItem = items.find((it) => it.str.trim() === "Effective date");
  if (!dateItem) return null;
  const y = dateItem.transform[5];
  const sameRow = items.filter((it) => Math.abs(it.transform[5] - y) < 1);
  const find = (label: string) => sameRow.find((it) => it.str.trim() === label);
  const descItem = find("Transaction description");
  const debitItem = find("Debits ($)");
  const creditItem = find("Credits ($)");
  const balanceItem = find("Balance ($)");
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

type InvestmentHeader = { y: number; dateX: number; productX: number; descX: number; qtyX: number; valueX: number };

function findInvestmentHeader(items: PdfTextItem[]): InvestmentHeader | null {
  const dateItem = items.find((it) => it.str.trim() === "Trade date");
  if (!dateItem) return null;
  const y = dateItem.transform[5];
  const sameRow = items.filter((it) => Math.abs(it.transform[5] - y) < 1);
  const find = (label: string) => sameRow.find((it) => it.str.trim() === label);
  const productItem = find("Investment product");
  const descItem = find("Transaction description");
  const qtyItem = find("Quantity");
  const valueItem = find("Value ($)");
  if (!productItem || !descItem || !qtyItem || !valueItem) return null;
  return {
    y,
    dateX: dateItem.transform[4],
    productX: productItem.transform[4],
    descX: descItem.transform[4],
    qtyX: qtyItem.transform[4],
    valueX: valueItem.transform[4],
  };
}

/**
 * Returns { legs, openingBalanceCents, closingBalanceCents, cashSum, buySellSum } for one page's
 * worth of the cash account table. Annual statements span multiple pages, each repeating the
 * header row; only the first page has an "Opening balance" row and only the last has "Closing
 * balance", so callers must merge per-page results across all pages where the header is found.
 */
function extractCashLegs(items: PdfTextItem[], header: CashHeader, filename: string) {
  const tableItems = items.filter((it) => it.str.trim() !== "" && it.transform[5] < header.y - 1);
  const blocks = blockify(tableItems);
  const midX = (header.debitX + header.creditX) / 2;

  const legs: CashLeg[] = [];
  let openingBalanceCents: number | null = null;
  let closingBalanceCents: number | null = null;
  let cashSum = 0;
  let buySellSum = 0;

  for (const block of blocks) {
    const dateItem = block.find((it) => Math.abs(it.transform[4] - header.dateX) < 6 && DATE_RE.test(it.str.trim()));
    if (!dateItem) continue;

    const description = textAtX(block, header.descX, 8);
    const debitItem = amountAtXRange(block, header.debitX - 30, midX);
    const creditItem = amountAtXRange(block, midX, header.creditX + 30);
    const balanceItem = amountAtXRange(block, header.balanceX - 15, Infinity);

    const delta = (creditItem ? amountToCents(creditItem.str) : 0) - (debitItem ? amountToCents(debitItem.str) : 0);
    const effectiveAt = dateToIsoZ(dateItem.str.trim());

    if (description === "Opening balance") {
      openingBalanceCents = balanceItem ? amountToCents(balanceItem.str) : null;
      continue;
    }
    if (description === "Closing balance") {
      closingBalanceCents = balanceItem ? amountToCents(balanceItem.str) : null;
      continue;
    }

    cashSum += delta;

    if (/^(Buy|Sell) transaction of /.test(description)) {
      buySellSum += delta;
      continue;
    }

    legs.push({ effectiveAt, description, amountCents: delta });
  }

  return { legs, openingBalanceCents, closingBalanceCents, cashSum, buySellSum };
}

/** Returns { legs, tradeSum } where tradeSum is the total AUD-leg delta across all trades. */
function extractTradeLegs(items: PdfTextItem[], header: InvestmentHeader, filename: string) {
  const tableItems = items.filter((it) => it.str.trim() !== "" && it.transform[5] < header.y - 1);
  const blocks = blockify(tableItems);

  const legs: TradeLeg[] = [];
  let tradeSum = 0;

  for (const block of blocks) {
    const dateItem = block.find((it) => Math.abs(it.transform[4] - header.dateX) < 6 && DATE_RE.test(it.str.trim()));
    if (!dateItem) continue;

    const productName = textAtX(block, header.productX, 8);
    const descText = textAtX(block, header.descX, 8);
    const qtyItem = amountAtXRange(block, header.qtyX - 20, header.qtyX + 20);
    const valueItem = amountAtXRange(block, header.valueX - 20, header.valueX + 20);

    if (!qtyItem || !valueItem) {
      console.error(`${filename}: trade row missing quantity/value, skipping: ${productName} / ${descText}`);
      continue;
    }

    const tickerMatch = productName.match(/\(([A-Z]+)\)\s*$/);
    if (!tickerMatch) {
      console.error(`${filename}: could not extract ticker from product name "${productName}", skipping`);
      continue;
    }
    const ticker = tickerMatch[1];
    const productNameClean = productName.slice(0, tickerMatch.index).trim();

    const isBuy = /^Buy\b/.test(descText);
    const isSell = /^Sell\b/.test(descText);
    if (!isBuy && !isSell) {
      console.error(`${filename}: unknown transaction type "${descText}", skipping`);
      continue;
    }

    const units = Math.round(parseFloat(qtyItem.str.replace(/,/g, "")));
    const valueCents = amountToCents(valueItem.str);
    const audDelta = isBuy ? -valueCents : valueCents;
    const etfDelta = isBuy ? units : -units;
    tradeSum += audDelta;

    const effectiveAt = dateToIsoZ(dateItem.str.trim());
    const verb = isBuy ? "Buy" : "Sell";
    const description = `${verb} ${units} ${ticker} - ${productNameClean}`;

    legs.push({ effectiveAt, description, ticker, audDelta, etfDelta });
  }

  return { legs, tradeSum };
}

type OutRow = {
  externalEventId: string;
  eventGroup: string;
  eventDescription: string;
  effectiveAt: string;
  postedAt: string;
  legDescription: string;
  legTicker: string;
  legUnitCount: number;
};

async function extractRows(pdfPath: string): Promise<OutRow[]> {
  const filename = basename(pdfPath);

  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await getDocument({ data, verbosity: 0 }).promise;

  // Quarterly statements fit the cash account / investment transaction tables on a single page
  // each; annual statements span multiple pages, each repeating the header row - so every page
  // is checked, and per-page results are merged.
  const cashLegs: CashLeg[] = [];
  let openingBalanceCents: number | null = null;
  let closingBalanceCents: number | null = null;
  let cashSum = 0;
  let buySellSum = 0;
  let foundCashTable = false;

  const tradeLegs: TradeLeg[] = [];
  let tradeSum = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as PdfTextItem[];

    const cashHeader = findCashHeader(items);
    if (cashHeader) {
      foundCashTable = true;
      const result = extractCashLegs(items, cashHeader, filename);
      cashLegs.push(...result.legs);
      cashSum += result.cashSum;
      buySellSum += result.buySellSum;
      if (result.openingBalanceCents !== null) openingBalanceCents = result.openingBalanceCents;
      if (result.closingBalanceCents !== null) closingBalanceCents = result.closingBalanceCents;
    }

    const investmentHeader = findInvestmentHeader(items);
    if (investmentHeader) {
      const result = extractTradeLegs(items, investmentHeader, filename);
      tradeLegs.push(...result.legs);
      tradeSum += result.tradeSum;
    }
  }

  if (!foundCashTable) {
    console.error(`${filename}: could not find Vanguard Cash Account transaction table`);
    return [];
  }

  if (openingBalanceCents !== null && closingBalanceCents !== null) {
    if (openingBalanceCents + cashSum !== closingBalanceCents) {
      console.error(
        `${filename}: cash account balance mismatch - opening ${openingBalanceCents} + transactions ${cashSum} = ${
          openingBalanceCents + cashSum
        }, but closing balance is ${closingBalanceCents}`
      );
    }
  } else {
    console.error(`${filename}: could not find opening/closing balance for cash account table`);
  }

  if (buySellSum !== tradeSum) {
    console.error(
      `${filename}: cash account Buy/Sell total (${buySellSum}) does not match investment transaction total (${tradeSum})`
    );
  }

  const rows: OutRow[] = [];

  for (const leg of cashLegs) {
    const id = rowHash([leg.effectiveAt, leg.description, String(leg.amountCents)]);
    rows.push({
      externalEventId: id,
      eventGroup: id,
      eventDescription: leg.description,
      effectiveAt: leg.effectiveAt,
      postedAt: leg.effectiveAt,
      legDescription: leg.description,
      legTicker: "AUD",
      legUnitCount: leg.amountCents,
    });
  }

  for (const trade of tradeLegs) {
    const id = rowHash([trade.effectiveAt, trade.ticker, trade.description, String(trade.audDelta)]);
    for (const [ticker, unitCount] of [
      ["AUD", trade.audDelta],
      [trade.ticker, trade.etfDelta],
    ] as const) {
      rows.push({
        externalEventId: id,
        eventGroup: id,
        eventDescription: trade.description,
        effectiveAt: trade.effectiveAt,
        postedAt: trade.effectiveAt,
        legDescription: trade.description,
        legTicker: ticker,
        legUnitCount: unitCount,
      });
    }
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);

  const allRows: OutRow[] = [];
  for (const inPath of args.inPaths) {
    const rows = await extractRows(inPath);
    console.error(`${basename(inPath)}: parsed ${rows.length} legs`);
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
    let id = row.externalEventId;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = rowHash([id, String(count)]);

    outLines.push(
      [
        csvEscape(id),
        csvEscape(row.eventGroup === row.externalEventId ? id : row.eventGroup),
        csvEscape(row.eventDescription),
        csvEscape(row.effectiveAt),
        csvEscape(row.postedAt),
        csvEscape(row.legDescription),
        csvEscape(row.legTicker),
        String(row.legUnitCount),
      ].join(",")
    );
  }

  writeFileSync(args.outPath, outLines.join("\n") + "\n", "utf8");
  console.log(`Wrote ${outLines.length - 1} rows to ${args.outPath}`);
}

main();
