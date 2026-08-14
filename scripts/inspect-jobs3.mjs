import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(here, '../data/draymond.db');
process.env.DRAYMOND_DB_PATH = dbFile;

const { getDb } = await import('../src/lib/db/connection');
const db = getDb();

console.log('=== SCHEDULED JOBS (name | expr | enabled | last_run | status | runs) ===');
try {
  const rows = db
    .prepare('SELECT name, cron_expression, is_enabled, last_run_at, last_run_status, run_count, fail_count, last_error FROM draymond_scheduled_jobs ORDER BY name')
    .all();
  for (const r of rows) {
    console.log(`${r.name} | ${r.cron_expression} | enabled=${r.is_enabled} | last=${r.last_run_at} | ${r.last_run_status} | runs=${r.run_count} fail=${r.fail_count}`);
    if (r.last_error) console.log(`    err: ${String(r.last_error).slice(0, 160)}`);
  }
} catch (e) {
  console.log('ERR', e.message);
}

console.log('\n=== science_experiments columns ===');
try {
  const cols = db.prepare('PRAGMA table_info(science_experiments)').all();
  console.log(JSON.stringify(cols.map((c) => c.name)));
} catch (e) {
  console.log('ERR', e.message);
}
