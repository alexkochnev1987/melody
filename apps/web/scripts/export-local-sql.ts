import { PGlite } from '@electric-sql/pglite';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { schemaSql } from '../lib/schema';

const tables = ['user', 'account', 'verification', 'session', 'game_sets', 'rooms', 'room_players', 'ai_usage'] as const;
const quoteName = (name: string) => `"${name.replaceAll('"', '""')}"`;
function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const text = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

async function main() {
  const local = await PGlite.create(path.join(process.cwd(), '.local', 'database'));
  const output = '/private/tmp/melody-export.sql';
  const statements = ['DO $melody_migration$ BEGIN', schemaSql, `
    IF EXISTS (SELECT 1 FROM "user") OR EXISTS (SELECT 1 FROM rooms)
      OR EXISTS (SELECT 1 FROM game_sets WHERE id <> 'starter-hits') THEN
      RAISE EXCEPTION 'Target database already contains user data';
    END IF;
  `];
  const counts: Record<string, number> = {};
  try {
    for (const table of tables) {
      let rows: Record<string, unknown>[];
      try {
        rows = (await local.query<Record<string, unknown>>(`SELECT * FROM ${quoteName(table)}`)).rows;
      } catch (error) {
        if (table === 'ai_usage' && error instanceof Error && /does not exist/.test(error.message)) rows = [];
        else throw error;
      }
      counts[table] = rows.length;
      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map(column => literal(row[column]));
        statements.push(`INSERT INTO ${quoteName(table)} (${columns.map(quoteName).join(', ')}) VALUES (${values.join(', ')}) ${table === 'game_sets' ? 'ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, songs=EXCLUDED.songs, updated_at=EXCLUDED.updated_at' : ''};`);
      }
    }
    statements.push('END $melody_migration$;');
    await writeFile(output, statements.join('\n'), { mode: 0o600 });
    console.log('Prepared SQL import file; row counts:', counts);
  } finally {
    await local.close();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
