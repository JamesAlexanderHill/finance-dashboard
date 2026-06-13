import { eq, and, ne, isNull, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '~/db'
import { legs, events, instruments, instrumentRates } from '~/db/schema'
import scaleUnit from '~/lib/scale-unit'

/**
 * Finds the most recent non-deleted, exactly-2-leg event where this
 * instrument's leg is paired with a leg in an instrument whose ticker
 * matches the user's home currency, and derives an implied "1 unit of
 * `instrumentId` = X units of home currency" rate from the two legs' amounts.
 */
export async function queryLatestExchangeRate(
  userId: string,
  instrumentId: string,
  homeCurrencyCode: string,
): Promise<{ rate: number; asOf: Date } | null> {
  const otherLeg = alias(legs, 'other_leg')
  const otherInstrument = alias(instruments, 'other_instrument')

  const [row] = await db
    .select({
      effectiveAt: events.effectiveAt,
      thisUnitCount: legs.unitCount,
      thisExponent: instruments.exponent,
      otherUnitCount: otherLeg.unitCount,
      otherExponent: otherInstrument.exponent,
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .innerJoin(instruments, eq(legs.instrumentId, instruments.id))
    .innerJoin(otherLeg, and(eq(otherLeg.eventId, events.id), ne(otherLeg.id, legs.id)))
    .innerJoin(otherInstrument, eq(otherLeg.instrumentId, otherInstrument.id))
    .where(and(
      eq(legs.instrumentId, instrumentId),
      eq(legs.userId, userId),
      isNull(events.deletedAt),
      eq(otherInstrument.ticker, homeCurrencyCode),
      sql`(select count(*) from legs l3 where l3.event_id = ${sql.raw('"events"."id"')}) = 2`,
    ))
    .orderBy(desc(events.effectiveAt))
    .limit(1)

  if (!row) return null

  const thisMajor = Math.abs(scaleUnit(BigInt(row.thisUnitCount), row.thisExponent))
  const otherMajor = Math.abs(scaleUnit(BigInt(row.otherUnitCount), row.otherExponent))
  if (thisMajor === 0) return null

  return { rate: otherMajor / thisMajor, asOf: new Date(row.effectiveAt) }
}

export async function queryRatesForInstruments(userId: string, instrumentIds: string[]) {
  if (instrumentIds.length === 0) return []

  return db
    .select()
    .from(instrumentRates)
    .where(and(
      eq(instrumentRates.userId, userId),
      inArray(instrumentRates.instrumentId, instrumentIds),
    ))
}
