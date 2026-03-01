import { eq, and, desc, inArray, sql } from "drizzle-orm"
import { db } from "."
import { Account, accounts, events, files, instruments, legs } from "./schema"

const parseAccessToken = (accessToken: string) => {
  // TODO: verify access token and return the current user
  // for now we are just passing the userId as the access token.
  return { id: accessToken };
}

type GetInstrumentOptions = {
  accountIds?: string[],
  limit?: number,
  offset?: number,
}
export const getInstruments = async (
  accessToken: string,
  { accountIds, limit, offset }: GetInstrumentOptions
) => {
  const currentUser = parseAccessToken(accessToken);

  const where = and(
    eq(instruments.userId, currentUser.id),
    accountIds?.length
      ? inArray(instruments.accountId, accountIds)
      : undefined
  );

  return db
    .select({
      id: instruments.id,
      userId: instruments.userId,
      accountId: instruments.accountId,
      name: instruments.name,
      ticker: instruments.ticker,
      exponent: instruments.exponent,

      // Sum of all legs for this instrument (string, no precision loss)
      balance: sql<string>`
        coalesce(sum(${legs.unitCount})::text, '0')
      `.as("balance"),
    })
    .from(instruments)
    .leftJoin(
      legs,
      and(
        eq(legs.instrumentId, instruments.id),
        eq(legs.userId, currentUser.id) // tenant safety
      )
    )
    .where(where)
    .groupBy(instruments.id)
    .limit(limit ?? 1000) // optional safety default
    .offset(offset ?? 0);
};

type GetFilesOptions = {
  accountId?: string,
  limit?: number,
  offset?: number,
}
export const getFiles = async (accessToken: string, {accountId, limit, offset}: GetFilesOptions) => {
  const currentUser = parseAccessToken(accessToken);
  
  return await db.query.files.findMany({
    where: and(
      eq(files.userId, currentUser.id),
      accountId ? eq(files.accountId, accountId) : undefined,
    ),
    orderBy: [desc(files.createdAt)],
    limit,
    offset,
  })
}

type GetEventOptions = {
  accountId?: string,
  limit?: number,
  offset?: number,
}
export const getEvents = async (accessToken: string, {accountId, limit, offset}: GetEventOptions) => {
  const currentUser = parseAccessToken(accessToken);

  return await db.query.events.findMany({
    where: and(
      eq(events.userId, currentUser.id),
      accountId ? eq(events.accountId, accountId) : undefined,
    ),
    orderBy: [desc(events.effectiveAt)],
    limit,
    offset,
    with: {
      account: true,
      legs: { with: { instrument: true } },
    },
  })
}

type GetAccountOptions = {
  limit?: number,
  offset?: number,
}
export const getAccounts = async (accessToken: string, { limit, offset }: GetAccountOptions) => {
  const currentUser = parseAccessToken(accessToken);

  return await db.query.accounts.findMany({
    where: eq(accounts.userId, currentUser.id),
    limit,
    offset,
    with: { instruments: true },
  })
}

export async function getInstrumentBalances(userId: string, accountIds?: string[]) {
  const where = and(
    eq(legs.userId, userId),
    accountIds?.length ? inArray(events.accountId, accountIds) : undefined
  );

  return db
    .select({
      accountId: events.accountId,
      instrumentId: legs.instrumentId,

      // optional instrument metadata
      ticker: instruments.ticker,
      exponent: instruments.exponent,
      instrumentName: instruments.name,

      // Cast bigint sum -> text so node-postgres returns string
      unitBalance: sql<string>`(sum(${legs.unitCount})::text)`.as("unitBalance"),
    })
    .from(legs)
    .innerJoin(events, eq(legs.eventId, events.id))
    .innerJoin(instruments, eq(legs.instrumentId, instruments.id))
    .where(where)
    .groupBy(
      events.accountId,
      legs.instrumentId,
      instruments.ticker,
      instruments.exponent,
      instruments.name
    );
}