import { parse } from "csv-parse/sync";
import type { ParseResult, ParsedRow } from "./types";

/**
 * Wise (TransferWise) CSV importer.
 *
 * Expected export format (Wise → Statements → CSV):
 * TransferWise ID,Date,Amount,Currency,Description,Payment Reference,
 * Running Balance,Exchange From,Exchange To,Exchange Rate,Payer Name,
 * Payee Name,Payee Account Number,Merchant,Card Last Four Digits,
 * Card Holder Full Name,Attachment,Note,Total fees
 *
 * - TransferWise ID: provider transaction ID (used as externalId)
 * - Date: YYYY-MM-DD
 * - Amount: signed decimal (negative = debit, positive = credit)
 * - Currency: ISO-4217 code for the Amount column
 * - Exchange From / Exchange To / Exchange Rate: populated for currency conversions
 * - Total fees: fee amount in the row's currency
 *
 * For simple transactions (no exchange), one leg is created.
 * For exchanges (Exchange From/To present), two legs are created:
 *   - The outgoing leg (sold currency, negative)
 *   - The incoming leg (bought currency, positive, calculated via exchange rate)
 * A separate fee leg is created when Total fees is non-zero.
 */
export function parseWiseCsv(csvContent: string): ParseResult {
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
    const lineNumber = i + 2; // +2 for 1-based index + header row
    const rec = records[i];

    try {
      const externalId = rec["TransferWise ID"]?.trim() || undefined;
      const dateStr = (rec["Date"] ?? "").trim();
      const amountStr = (rec["Amount"] ?? "").replace(/,/g, "").trim();
      const currency = (rec["Currency"] ?? "").trim().toUpperCase();
      const description = (
        rec["Description"] ||
        rec["Payment Reference"] ||
        "Wise transaction"
      ).trim();
      const exchangeFrom = rec["Exchange From"]?.trim() || "";
      const exchangeTo = rec["Exchange To"]?.trim() || "";
      const exchangeRateStr = rec["Exchange Rate"]?.trim() || "";
      const feesStr = (rec["Total fees"] ?? "").replace(/,/g, "").trim();

      if (!dateStr) {
        errors.push({ line: lineNumber, message: "Missing date" });
        continue;
      }
      const effectiveAt = new Date(`${dateStr}T00:00:00Z`);

      if (!amountStr || isNaN(Number(amountStr))) {
        errors.push({
          line: lineNumber,
          message: `Invalid amount: ${rec["Amount"]}`,
        });
        continue;
      }

      const isExchange =
        exchangeFrom !== "" &&
        exchangeTo !== "" &&
        exchangeRateStr !== "" &&
        !isNaN(Number(exchangeRateStr)) &&
        Number(exchangeRateStr) > 0;

      const feeAmount = Number(feesStr);
      const hasFee = !isNaN(feeAmount) && feeAmount !== 0;

      if (isExchange) {
        const rate = Number(exchangeRateStr);
        const fromAmount = Number(amountStr); // negative (outgoing)
        const toAmount = (-fromAmount / rate).toFixed(2); // positive (incoming)

        const legs: ParsedRow["legs"] = [
          { instrumentCode: exchangeFrom.toUpperCase(), amountDecimal: amountStr },
          { instrumentCode: exchangeTo.toUpperCase(), amountDecimal: toAmount },
        ];

        if (hasFee) {
          legs.push({
            instrumentCode: currency,
            amountDecimal: (-Math.abs(feeAmount)).toFixed(2),
          });
        }

        rows.push({
          externalId,
          effectiveAt,
          description,
          eventType: "exchange",
          legs,
          meta: { exchangeRate: rate, exchangeFrom, exchangeTo },
        });
      } else {
        const legs: ParsedRow["legs"] = [
          { instrumentCode: currency, amountDecimal: amountStr },
        ];

        if (hasFee) {
          legs.push({
            instrumentCode: currency,
            amountDecimal: (-Math.abs(feeAmount)).toFixed(2),
          });
        }

        // Infer event type from description
        const descLower = description.toLowerCase();
        const eventType = descLower.includes("transfer") ? "transfer" : "purchase";

        rows.push({
          externalId,
          effectiveAt,
          description,
          eventType,
          legs,
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
