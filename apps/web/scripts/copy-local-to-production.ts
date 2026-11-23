import { PGlite } from '@electric-sql/pglite';
import { Pool } from '@neondatabase/serverless';
import path from 'node:path';
import { schemaSql } from '../lib/schema';

const tables = ['user', 'account', 'verification', 'session', 'game_sets', 'rooms', 'room_players', 'ai_usage'] as const;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the production database.');
  const local = await PGlite.create(path.join(process.cwd(), '.local', 'database'));
  const remote = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const counts: Record<string, number> = {};
  try {
  await remote.query('BEGIN');
  await remote.query(schemaSql);
  const existing = await remote.query(`SELECT
    (SELECT count(*)::int FROM "user") AS users,
    (SELECT count(*)::int FROM game_sets WHERE id <> 'starter-hits') AS sets,
    (SELECT count(*)::int FROM rooms) AS rooms,
    (SELECT count(*)::int FROM room_players) AS players`);
  if (Object.values(existing.rows[0]).some(value => Number(value) !== 0)) {
    throw new Error('Target database already contains user data; migration was not applied.');
  }
  for (const table of tables) {
    let rows: Record<string, unknown>[];
    try {
      rows = (await local.query<Record<string, unknown>>(`SELECT * FROM ${quote(table)}`)).rows;
    } catch (error) {
      if (table === 'ai_usage' && error instanceof Error && /does not exist/.test(error.message)) {
        rows = [];
      } else {
        throw error;
      }
    }
    counts[table] = rows.length;
    for (const row of rows) {
      const columns = Object.keys(row);
      const values = columns.map(column => {
        const value = row[column];
        return (column === 'state' || column === 'songs') && typeof value !== 'string'
          ? JSON.stringify(value)
          : value;
      });
      await remote.query(
        `INSERT INTO ${quote(table)} (${columns.map(quote).join(',')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})
         ${table === 'game_sets' ? 'ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, songs=EXCLUDED.songs, updated_at=EXCLUDED.updated_at' : ''}`,
        values,
      );
    }
  }
  await remote.query('COMMIT');
  console.log('Copied rows:', counts);
  } catch (error) {
    await remote.query('ROLLBACK');
    throw error;
  } finally {
    await local.close();
    await remote.end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
