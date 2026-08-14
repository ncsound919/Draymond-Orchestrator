import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(here, '../data/draymond.db');
process.env.DRAYMOND_DB_PATH = dbFile;

const { getDb } = await import('../src/lib/db/connection');
const db = getDb();

const rows = db
  .prepare('SELECT experiment_id, goal_id, hypothesis_id, domain, type, model_id, status, evidence_tier, result, error, created_at FROM science_experiments ORDER BY created_at')
  .all();

for (const r of rows) {
  let summary = '';
  try {
    const res = JSON.parse(r.result || '{}');
    if (res.outputs) summary = 'outputs=' + JSON.stringify(res.outputs);
    else if (res.metrics) summary = 'metrics=' + JSON.stringify(res.metrics).slice(0, 200);
    else if (res.report) summary = 'report=' + JSON.stringify(res.report).slice(0, 200);
    else summary = 'result=' + JSON.stringify(res).slice(0, 200);
  } catch (e) {
    summary = 'result=' + String(r.result).slice(0, 200);
  }
  console.log(
    `${r.status} | ${r.domain}/${r.type} | ${r.model_id || r.goal_id} | tier=${r.evidence_tier} | ${summary} | ${r.created_at}`
  );
}
