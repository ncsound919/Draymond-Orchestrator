/**
 * Create the oncology partner outreach campaign in AetherDesk.
 * Reads AETHERDESK_API_KEY from .env.local; base URL per fleet-manifest (port 8002, /api/v1).
 * No leads, no launch. Dry-run unless --apply.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeAetherDeskOperation } from '../src/lib/draymond/aetherdesk';

const ROOT = resolve(process.cwd());
const env = readFileSync(resolve(ROOT, '.env.local'), 'utf-8');
function envVal(key: string): string {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const key = envVal('AETHERDESK_API_KEY');
  if (!key) throw new Error('AETHERDESK_API_KEY not found in .env.local');
  process.env.AETHERDESK_API_KEY = key;
  process.env.AETHERDESK_BASE_URL = 'http://127.0.0.1:8002/api/v1';

  const campaignPath = resolve(process.env.UPLIFT_ROOT ?? resolve(ROOT, '..'), 'plans', 'oncology-partner-outreach-campaign.json');
  const config = JSON.parse(readFileSync(campaignPath, 'utf-8')) as { campaign: Record<string, unknown> };

  if (!apply) {
    console.log('[create-oncology-campaign] DRY-RUN — payload:');
    console.log(JSON.stringify(config.campaign, null, 2));
    console.log('\n[create-oncology-campaign] re-run with --apply to POST /campaign/campaigns');
    return;
  }

  const result = await executeAetherDeskOperation('create_campaign', config.campaign, { timeoutMs: 30_000 });
  console.log(`[create-oncology-campaign] success=${result.success} status=${result.status_code ?? 'n/a'}`);
  console.log(JSON.stringify(result.output, null, 2));
  if (!result.success && result.error) console.error('[create-oncology-campaign] error:', result.error);
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('[create-oncology-campaign] FAILED', err);
  process.exit(1);
});