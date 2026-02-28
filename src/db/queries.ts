import { eq } from "drizzle-orm"
import { db } from "."
import { accounts, instruments } from "./schema"

export const getUserInstruments = async (userId: string) => {
  return await db
    .select()
    .from(instruments)
    .where(eq(instruments.userId, userId))
}

export const getUserAccounts = async (userId: string) => {
  return await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
}