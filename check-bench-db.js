const Database = require('better-sqlite3');
const fs = require('fs');
const p = process.env.DRAYMOND_DB_PATH;
console.log('db path:', p, 'exists:', fs.existsSync(p));
const db = new Database(p);
const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%benchmark%'").all();
console.log('tables:', JSON.stringify(rows));
const cols = db.prepare('PRAGMA table_info(draymond_benchmarks)').all().map(c => c.name);
console.log('bench cols:', JSON.stringify(cols));
try {
  const info = db.prepare("INSERT INTO draymond_benchmarks (run_id, component_class, component_slug, component_name, metrics, weakness_score, trend, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run('test-1', 'entity', 'probe', 'Probe', JSON.stringify({ overall_score: 1 }), 1, JSON.stringify({}), null);
  console.log('insert ok:', JSON.stringify(info));
} catch (e) {
  console.log('INSERT ERROR:', e.message);
}
