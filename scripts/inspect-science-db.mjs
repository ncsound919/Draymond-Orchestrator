import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(here, '../data/draymond.db');
process.env.DRAYMOND_DB_PATH = dbFile;

const { getDb } = await import('../src/lib/db/connection');
const db = getDb();

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('TABLES:', tables.map((t) => t.name).join(', '));
} catch (e) {
  console.log('ERR tables', e.message);
}

try {
  const r = db.prepare('SELECT status, type, domain, count(*) as n FROM science_experiments GROUP BY status, type, domain').all();
  console.log('SCIENCE_EXPERIMENTS:', JSON.stringify(r, null, 2));
} catch (e) {
  console.log('ERR experiments', e.message);
}
