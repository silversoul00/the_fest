// Applies db/schema.sql to DATABASE_URL.  Usage: npm run db:setup
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from './env.mjs';

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set (put it in .env.local)'); process.exit(1); }

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {}, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '') ? false : 'require' });
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
try {
  await sql.unsafe(schema);
  console.log('✓ Schema applied');
} catch (e) {
  console.error('✗ Schema failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
