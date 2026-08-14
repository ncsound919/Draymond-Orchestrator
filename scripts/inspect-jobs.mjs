import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(here, '../data/draymond.db');
process.env.DRAYMOND_DB_PATH = dbFile;

const { getDb } = await import('../src/lib/db/connection');
const db = getDb();

console.log('=== SCHEDULED JOBS (research/science related) ===');
try {
  const rows = db.prepare("SELECT name, cron, enabled, last_run, last_status FROM draymond_scheduled_jobs WHERE name LIKE '%esearch%' OR name LIKE '%cience%' OR name LIKE '%xperiment%' OR name LIKE '%otation%'").all();
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.log('ERR', e.message);
}

console.log('\n=== ALL SCHEDULED JOBS (count + enabled) ===');
try {
  const rows = db.prepare('SELECT name, cron, enabled, last_status FROM draymond_scheduled_jobs').all();
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.log('ERR', e.message);
}

console.log('\n=== DRAYMOND AGENTS w/ science/sports/biotech roles ===');
try {
  const rows = db.prepare("SELECT slug, name, status FROM draymond_agents WHERE slug LIKE '%science%' OR slug LIKE '%sport%' OR slug LIKE '%biotech%' OR slug LIKE '%research%'").all();
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.log('ERR', e.message);
}
