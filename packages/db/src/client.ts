import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
/** A Drizzle handle that is either the root database or a DB transaction. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}

let cached: ReturnType<typeof createDb> | undefined;

/** Process-wide shared connection. */
export function getDb(): Database {
  cached ??= createDb();
  return cached.db;
}
