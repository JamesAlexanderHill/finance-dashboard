import { parse } from "csv-parse/sync";
import type { ParseResult, ParsedRow } from "./types";

/**
 * CommBank (Commonwealth Bank) CSV importer.
 *
 * Expected export format (NetBank → Download transactions → CSV):
 *   Date,Amount,Balance,"Transaction Description"[,Serial]
 *   26/01/2025,-37.50,1200.00,"WOOLWORTHS 1234  PENRITH",12345678
 *
 * - Date: DD/MM/YYYY
 * - Amount: signed decimal (negative = debit, positive = credit)
 * - Balance: ignored (derived from legs)
 * - Transaction Description: the human-readable description
 * - Serial: optional provider transaction ID (last column if present)
 *
 * importInstrumentCode: the instrument code for all amounts (e.g. "AUD")
 */
export function parseCommBankCsv(
  csvContent: string,
  importInstrumentCode: string,
): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseResult["errors"] = [];

  let records: Record<string, string>[];
  try {
    records = parse(csvContent, {
      // CommBank CSVs have no header row — we name the columns ourselves
      columns: ["date", "amount", "balance", "description", "serial"],
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (err) {
    return {
      rows: [],
      errors: [{ line: 0, message: `CSV parse error: ${String(err)}` }],
    };
  }

  for (let i = 0; i < records.length; i++) {
    const lineNumber = i + 1;
    const rec = records[i];

    try {
      // Parse date: DD/MM/YYYY
      const [day, month, year] = (rec.date ?? "").split("/");
      if (!day || !month || !year) {
        errors.push({ line: lineNumber, message: `Invalid date: ${rec.date}` });
        continue;
      }
      const effectiveAt = new Date(
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`,
      );

      // Strip commas from amounts (CBA formats large numbers with commas)
      const amountStr = (rec.amount ?? "").replace(/,/g, "").trim();
      if (!amountStr || isNaN(Number(amountStr))) {
        errors.push({
          line: lineNumber,
          message: `Invalid amount: ${rec.amount}`,
        });
        continue;
      }

      const description = (rec.description ?? "").trim();
      if (!description) {
        errors.push({
          line: lineNumber,
          message: "Missing transaction description",
        });
        continue;
      }

      const serial = rec.serial?.trim() || undefined;

      // Infer event type: "transfer" if the description contains common CBA
      // transfer keywords, otherwise default to "purchase".
      const descLower = description.toLowerCase();
      const eventType =
        descLower.includes("transfer") || descLower.includes("internet trf")
          ? "transfer"
          : "purchase";

      rows.push({
        externalId: serial,
        effectiveAt,
        description,
        eventType,
        legs: [
          {
            instrumentCode: importInstrumentCode,
            amountDecimal: amountStr,
          },
        ],
      });
    } catch (err) {
      errors.push({
        line: lineNumber,
        message: `Unexpected error: ${String(err)}`,
      });
    }
  }

  return { rows, errors };
}
