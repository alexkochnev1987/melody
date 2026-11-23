import 'server-only';
import { Pool } from '@neondatabase/serverless';

type QueryResult<T> = { rows: T[] };
type QueryClient = {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
};
export type DatabaseClient = QueryClient & {
  transaction<T>(operation: (client: QueryClient) => Promise<T>): Promise<T>;
};

const globalDb = globalThis as typeof globalThis & { melodyPool?: Pool };

export function remotePool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for deployment');
  if (!globalDb.melodyPool) globalDb.melodyPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  return globalDb.melodyPool;
}

export async function database(): Promise<DatabaseClient> {
    const pool = remotePool();
    return {
      query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await pool.query(sql, params)).rows as T[] }),
      transaction: async <T>(operation: (client: QueryClient) => Promise<T>) => {
        const connection = await pool.connect();
        try {
          await connection.query('BEGIN');
          const result = await operation({ query: async <R>(sql: string, params?: unknown[]) => ({ rows: (await connection.query(sql, params)).rows as R[] }) });
          await connection.query('COMMIT');
          return result;
        } catch (error) {
          await connection.query('ROLLBACK');
          throw error;
        } finally {
          connection.release();
        }
      },
    };
}
