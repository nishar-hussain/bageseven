import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbOptions {
  connectionString: string;
  max?: number;
}

export function createDb({ connectionString, max = 10 }: DbOptions): Database {
  const pool = new pg.Pool({ connectionString, max });
  return drizzle(pool, { schema });
}

export { schema };