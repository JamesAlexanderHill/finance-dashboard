import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const { db, client } = createDb();
await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
await client.end();
console.log('Migrations applied');
