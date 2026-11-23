import { Pool } from '@neondatabase/serverless';
import { schemaSql } from '../lib/schema';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the target database before migration.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(schemaSql);
    console.log('Melody schema is ready.');
  } finally {
    await pool.end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
