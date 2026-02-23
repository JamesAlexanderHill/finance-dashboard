import { parse } from "csv-parse/sync";
import type { ParseResult, ParsedRow } from "./types";

/**
 * Vanguard CSV importer (Australian brokerage transactions).
 *
 * Expected export format:
 *   Date, Type, Product Type, Product Name, Product ID, Units, Total
 *   06-Apr-2025, Buy, ETF, Vanguard Diversified All Growth ETF, VDAL, 19, -855
 *
 * - Date: DD-Mon-YYYY (e.g. "06-Apr-2025")
 * - Type: "Buy" | "Sell" | "Distribution" | etc.
 * - Product Type: "ETF" | "Managed Fund" | etc.
 * - Product Name: full fund name
 * - Product ID: ticker/code used as instrument code (e.g. "VDAL")
 * - Units: signed integer (positive = acquired, negative = disposed)
 * - Total: signed decimal in importInstrumentCode (negative = cash outflow for Buy)
 *
 * importInstrumentCode: the cash instrument for this account (e.g. "AUD")
 */
export function parseVanguardCsv(
  csvContent: string,
  importInstrumentCode: string,
): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseResult["errors"] = [];

  let records: Record<string, string>[];
  try {
    records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
  } catch (err) {
    return {
      rows: [],
      errors: [{ line: 0, message: `CSV parse error: ${String(err)}` }],
    };
  }

  for (let i = 0; i < records.length; i++) {
    const lineNumber = i + 2; // +2 for 1-based + header
    const rec = records[i];

    try {
      const dateStr = (rec["Date"] ?? "").trim();
      const type = (rec["Type"] ?? "").trim();
      const productName = (rec["Product Name"] ?? "").trim();
      const productId = (rec["Product ID"] ?? "").trim().toUpperCase();
      const unitsStr = (rec["Units"] ?? "").replace(/,/g, "").trim();
      const totalStr = (rec["Total"] ?? "").replace(/,/g, "").trim();

      if (!dateStr) {
        errors.push({ line: lineNumber, message: "Missing date" });
        continue;
      }

      // Parse date: DD-Mon-YYYY → YYYY-MM-DD
      const effectiveAt = parseVanguardDate(dateStr);
      if (!effectiveAt) {
        errors.push({
          line: lineNumber,
          message: `Invalid date format: ${dateStr}`,
        });
        continue;
      }

      if (!productId) {
        errors.push({ line: lineNumber, message: "Missing Product ID" });
        continue;
      }

      if (!unitsStr || isNaN(Number(unitsStr))) {
        errors.push({
          line: lineNumber,
          message: `Invalid units: ${rec["Units"]}`,
        });
        continue;
      }

      if (!totalStr || isNaN(Number(totalStr))) {
        errors.push({
          line: lineNumber,
          message: `Invalid total: ${rec["Total"]}`,
        });
        continue;
      }

      const typeLower = type.toLowerCase();
      const isTrade = typeLower === "buy" || typeLower === "sell";

      if (isTrade) {
        // Trade: two legs — units in the security instrument + cash in importInstrument
        rows.push({
          effectiveAt,
          description: `${type} ${productId}${productName ? " - " + productName : ""}`,
          eventType: "trade",
          legs: [
            // Security leg: units (minorUnit=0 for MVP, so amountDecimal = units as-is)
            { instrumentCode: productId, amountDecimal: unitsStr },
            // Cash leg: total (negative for buy, positive for sell)
            { instrumentCode: importInstrumentCode, amountDecimal: totalStr },
          ],
          meta: { type, productName, productId },
        });
      } else {
        // Distribution or other single-leg event
        rows.push({
          effectiveAt,
          description: `${type}${productName ? " - " + productName : ""}`,
          eventType: "payout",
          legs: [
            { instrumentCode: importInstrumentCode, amountDecimal: totalStr },
          ],
          meta: { type, productName, productId, units: unitsStr },
        });
      }
    } catch (err) {
      errors.push({
        line: lineNumber,
        message: `Unexpected error: ${String(err)}`,
      });
    }
  }

  return { rows, errors };
}

const MONTH_MAP: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function parseVanguardDate(dateStr: string): Date | null {
  // Format: DD-Mon-YYYY e.g. "06-Apr-2025"
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const [day, monthAbbr, year] = parts;
  const month = MONTH_MAP[monthAbbr.toLowerCase()];
  if (!month) return null;
  return new Date(
    `${year}-${month}-${day.padStart(2, "0")}T00:00:00Z`,
  );
}
