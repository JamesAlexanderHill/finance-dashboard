import { eq, and, desc, inArray, sql } from "drizzle-orm"
import { db } from "."
import { Account, accounts, events, files, Instrument, instruments, legs } from "./schema"

const parseAccessToken = (accessToken: string) => {
  // TODO: verify access token and return the current user
  // for now we are just passing the userId as the access token.
  return { id: accessToken };
}

type GetInstrumentsOptions = {
  accountIds?: string[],
  limit?: number,
  offset?: number,
}
/**
 * Fetches instruments for the current user, optionally filtered by account IDs. Each instrument includes a balance which is the sum of all legs associated with that instrument
 * 
 * Extra:
 * - balance: the sum of all leg minor units for that instrument
 * 
 * @param accessToken - A users access token
 * @param options - Options for fetching instruments
 * @param options.accountIds Optional filter to only return instruments for specific accounts. If not provided, returns instruments for all accounts the user has access to.
 * @param options.limit Optional pagination limit
 * @param options.offset Optional pagination offset 
 * 
 * @returns A list of instruments with their balances
 */
export const getInstruments = async (
  accessToken: string,
  { accountIds, limit, offset }: GetInstrumentsOptions
): Promise<(Instrument & {balance: string})[]> => {
  const currentUser = parseAccessToken(accessToken);

  const where = and(
    eq(instruments.userId, currentUser.id),
    accountIds?.length
      ? inArray(instruments.accountId, accountIds)
      : undefined
  );

  return db
    .select({
      // Instrument fields
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
/**
 * Fetches files for the current user, optionally filtered by account ID.
 * 
 * @param accessToken - A users access token
 * @param options - Options for fetching files
 * @param options.accountId Optional filter to only return files for a specific account. If not provided, returns files for all accounts the user has access to.
 * @param options.limit Optional pagination limit
 * @param options.offset Optional pagination offset
 * @returns A list of files
 */
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
/**
 * Fetches events for the current user, optionally filtered by account ID. Events are ordered by effective date descending.
 * 
 * With:
 * - account: the account associated with the event
 * - legs: the legs associated with the event, each leg includes its instrument data
 * 
 * @param accessToken - A users access token
 * @param options - Options for fetching events
 * @param options.accountId Optional filter to only return events for a specific account. If not provided, returns events for all accounts the user has access to.
 * @param options.limit Optional pagination limit
 * @param options.offset Optional pagination offset
 * @returns A list of events
 */
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
  accountIds?: string[],
}
/**
 * Fetches accounts for the current user
 * 
 * with:
 * - instruments: the instruments associated with each account
 * 
 * @param accessToken - A users access token
 * @param options - Options for fetching accounts
 * @param options.limit Optional pagination limit
 * @param options.offset Optional pagination offset
 * @param options.accountIds Optional filter to only return accounts with specific IDs. If not provided, returns all accounts the user has access to.
 * 
 * @returns A list of Accounts and their Instruments
 */
export const getAccounts = async (accessToken: string, { limit, offset, accountIds }: GetAccountOptions) => {
  const currentUser = parseAccessToken(accessToken);

  return await db.query.accounts.findMany({
    where: and(
      eq(accounts.userId, currentUser.id),
      accountIds?.length ? inArray(accounts.id, accountIds) : undefined
    ),
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