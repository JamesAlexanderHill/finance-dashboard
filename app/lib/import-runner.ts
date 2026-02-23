import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { db } from "../db";
import {
  accounts,
  events,
  importRuns,
  instruments,
  legs,
} from "../db/schema";
import { parseCommBankCsv } from "../importers/commbank_csv_v1";
import { parseWiseCsv } from "../importers/wise_csv_v1";
import { parseVanguardCsv } from "../importers/vanguard_csv_v1";
import { computeDedupeKey } from "./dedupe";
import type { ParsedRow } from "../importers/types";
import type { ImportRun, Instrument } from "../db/schema";

type ImportRunResult = ImportRun;

/** Convert a decimal string to minor units using the instrument's minorUnit. */
function toMinorUnits(amountDecimal: string, minorUnit: number): bigint {
  const factor = Math.pow(10, minorUnit);
  const value = Math.round(parseFloat(amountDecimal) * factor);
  return BigInt(value);
}

export async function runImport(params: {
  userId: string;
  accountId: string;
  importInstrumentId: string;
  filename: string;
  csvContent: string;
  restoreDeletedChosen: boolean;
}): Promise<ImportRunResult> {
  const {
    userId,
    accountId,
    importInstrumentId,
    filename,
    csvContent,
    restoreDeletedChosen,
  } = params;

  // ── 1. Load account & import instrument ─────────────────────────────────────
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));

  if (!account) throw new Error(`Account not found: ${accountId}`);

  const [importInstrument] = await db
    .select()
    .from(instruments)
    .where(
      and(
        eq(instruments.id, importInstrumentId),
        eq(instruments.userId, userId),
      ),
    );

  if (!importInstrument)
    throw new Error(`Instrument not found: ${importInstrumentId}`);

  // ── 2. Load all user instruments for code-based resolution ──────────────────
  const userInstruments = await db
    .select()
    .from(instruments)
    .where(eq(instruments.userId, userId));

  const instrumentByCode = new Map<string, Instrument>(
    userInstruments.map((ins) => [ins.code.toUpperCase(), ins]),
  );

  // ── 3. Parse the CSV ────────────────────────────────────────────────────────
  let parseResult;
  switch (account.importerKey) {
    case "commbank_csv_v1":
      parseResult = parseCommBankCsv(csvContent, importInstrument.code);
      break;
    case "wise_csv_v1":
      parseResult = parseWiseCsv(csvContent);
      break;
    case "vanguard_csv_v1":
      parseResult = parseVanguardCsv(csvContent, importInstrument.code);
      break;
    default:
      throw new Error(`Unknown importerKey: ${account.importerKey}`);
  }

  // ── 4. Process each parsed row ───────────────────────────────────────────────
  let importedCount = 0;
  let skippedCount = 0;
  let restoredCount = 0;
  let errorCount = parseResult.errors.length;
  const skippedKeys: string[] = [];
  const allErrors = [...parseResult.errors.map((e) => ({ ...e, phase: "parse" }))];

  for (let i = 0; i < parseResult.rows.length; i++) {
    const row = parseResult.rows[i];

    try {
      // Resolve legs + compute primary amount for dedupe key
      const resolvedLegs = resolveLegInstruments(row, instrumentByCode);
      if (resolvedLegs === null) {
        // instrument not found — treated as parse error
        errorCount++;
        allErrors.push({
          line: i + 1,
          message: `Unknown instrument in row: ${JSON.stringify(row.legs.map((l) => l.instrumentCode))}`,
          phase: "resolve",
        });
        continue;
      }

      const primaryAmountMinor = resolvedLegs[0]?.amountMinor ?? BigInt(0);

      const dedupeKey = computeDedupeKey({
        accountId,
        externalId: row.externalId,
        effectiveAt: row.effectiveAt,
        amountMinor: primaryAmountMinor,
        description: row.description,
      });

      // Check for existing event with this dedupeKey
      const [existing] = await db
        .select({ id: events.id, deletedAt: events.deletedAt })
        .from(events)
        .where(eq(events.dedupeKey, dedupeKey));

      if (existing) {
        if (!existing.deletedAt) {
          // Active duplicate — skip
          skippedCount++;
          skippedKeys.push(dedupeKey);
          continue;
        }

        // Soft-deleted — restore or skip
        if (restoreDeletedChosen) {
          await db
            .update(events)
            .set({ deletedAt: null, updatedAt: new Date() })
            .where(eq(events.id, existing.id));
          restoredCount++;
        } else {
          skippedCount++;
          skippedKeys.push(dedupeKey);
        }
        continue;
      }

      // ── Insert new event + legs in a transaction ────────────────────────────
      await db.transaction(async (tx) => {
        const [newEvent] = await tx
          .insert(events)
          .values({
            userId,
            profileId: account.profileId,
            accountId,
            eventType: row.eventType,
            effectiveAt: row.effectiveAt,
            postedAt: row.postedAt,
            description: row.description,
            externalId: row.externalId,
            dedupeKey,
            meta: row.meta ?? null,
          })
          .returning({ id: events.id });

        for (const leg of resolvedLegs) {
          await tx.insert(legs).values({
            eventId: newEvent.id,
            accountId,
            instrumentId: leg.instrumentId,
            amountMinor: leg.amountMinor,
          });
        }
      });

      importedCount++;
    } catch (err) {
      errorCount++;
      allErrors.push({
        line: i + 1,
        message: `Insert error: ${String(err)}`,
        phase: "insert",
      });
    }
  }

  // ── 5. Create ImportRun record ───────────────────────────────────────────────
  const [run] = await db
    .insert(importRuns)
    .values({
      userId,
      accountId,
      filename,
      importInstrumentId,
      importedCount,
      skippedCount,
      restoredCount,
      errorCount,
      skippedKeys,
      errors: allErrors,
      restoreDeletedChosen,
    })
    .returning();

  return run;
}

interface ResolvedLeg {
  instrumentId: string;
  amountMinor: bigint;
}

function resolveLegInstruments(
  row: ParsedRow,
  instrumentByCode: Map<string, Instrument>,
): ResolvedLeg[] | null {
  const resolved: ResolvedLeg[] = [];

  for (const leg of row.legs) {
    const instrument = instrumentByCode.get(leg.instrumentCode.toUpperCase());
    if (!instrument) return null;

    const amountMinor = toMinorUnits(leg.amountDecimal, instrument.minorUnit);
    resolved.push({ instrumentId: instrument.id, amountMinor });
  }

  return resolved;
}
