import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(here, '../data/draymond.db');
process.env.DRAYMOND_DB_PATH = dbFile;

const { getDb } = await import('../src/lib/db/connection');
const db = getDb();

console.log('=== SCHEDULED JOBS SCHEMA ===');
try {
  const cols = db.prepare('PRAGMA table_info(draymond_scheduled_jobs)').all();
  console.log(JSON.stringify(cols, null, 2));
} catch (e) {
  console.log('ERR', e.message);
}

console.log('\n=== SCHEDULED JOBS ROWS ===');
try {
  const rows = db.prepare('SELECT * FROM draymond_scheduled_jobs').all();
  console.log(JSON.stringify(rows, null, 2).slice(0, 6000));
} catch (e) {
  console.log('ERR', e.message);
}
