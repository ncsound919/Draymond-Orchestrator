import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DRAYMOND_REGISTRY_DIR = resolve(here, '../.draymond');

async function main() {
  const { runPoolHealth } = await import('../src/lib/draymond/pool-health');
  const s = await runPoolHealth({ restartLitellm: true });
  console.log('checkedAt:', s.checkedAt);
  console.log('muse free active keys:', s.museFreeActiveKeys.join(', ') || '(none)');
  console.log('free active keys     :', s.freeActiveKeys.join(', ') || '(none)');
  console.log('free model availability:', JSON.stringify(s.freeModelAvailability));
  console.log('openrouter           :', s.openrouter?.status, s.openrouter?.detail ?? '');
  console.log('deepseek             :', s.deepseek?.status, s.deepseek?.detail ?? '');
  console.log('ollama cloud alive   :', `${s.ollamaCloud.filter((o) => o.ok).length}/${s.ollamaCloud.length}`);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
