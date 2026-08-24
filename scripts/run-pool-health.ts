import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DRAYMOND_REGISTRY_DIR = resolve(here, '../.draymond');

async function main() {
  const { runPoolHealth } = await import('../src/lib/draymond/pool-health');
  const s = await runPoolHealth({ restartLitellm: true });
  console.log('checkedAt:', s.checkedAt);
  console.log('ox-alpha active keys :', s.oxAlphaActiveKeys.join(', ') || '(none)');
  console.log('zen-free only keys   :', s.zenFreeOnlyKeys.join(', ') || '(none)');
  console.log('openrouter           :', s.openrouter?.status, s.openrouter?.detail ?? '');
  console.log('deepseek             :', s.deepseek?.status, s.deepseek?.detail ?? '');
  console.log('ollama cloud alive   :', `${s.ollamaCloud.filter((o) => o.ok).length}/${s.ollamaCloud.length}`);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
