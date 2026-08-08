// ============================================================================
// DRAYMOND AGENT IDE — remediation collector ("skills born out of the tools")
// ============================================================================
// The repair team's "skills" are adapters over the analysis engines' own
// remediation output:
//   • Codegang — analyze findings (fixSuggestion) + the self-healing pipeline
//     (HealingActions with original→proposed code).
//   • RepoRank — repo-level scan remediation (fix packs) when a repo URL exists.
//   • Grader   — data-backed recommendations when a repo URL exists.
//   • Probe    — operational fixes (env, installs, ports, restart) derived from
//     the service diagnosis, not guessed.
// Everything funnels into a single RemediationItem list the executor can apply.
// ============================================================================

import { codegangAnalyzeFile, codegangHealProject, codegangIsUp } from './codegang-client';
import { scoreWithReporank, scoreWithGrader } from '../draymond/deep-scorers';
import { toolBySlug } from '../draymond/ports';
import type { ServiceDiagnosis } from './service-probe';
import type { IdeRepairAction } from './types';

export interface RemediationItem {
  source: 'codegang' | 'reporank' | 'grader' | 'probe';
  severity?: string;
  title: string;
  description?: string;
  file?: string;
  /** Human-readable fix guidance. */
  fix?: string;
  /** Structured action the executor can apply. null = informational (needs codegen/human). */
  apply: IdeRepairAction | null;
  confidence?: number;
}

const KNOWN_STUB_ENV: Record<string, string> = {
  GITHUB_CLIENT_ID: 'draymond-local',
  GITHUB_CLIENT_SECRET: 'draymond-local-secret',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  RESEND_API_KEY: 're_dummy',
};

function serviceEnvFile(slug: string): string | undefined {
  const tool = toolBySlug(slug);
  return tool?.cwd ? `${tool.cwd}/.env` : undefined;
}

/** Operational remediation derived from a service probe. */
function opsRemediation(probe: ServiceDiagnosis): RemediationItem[] {
  const items: RemediationItem[] = [];
  const tool = toolBySlug(probe.slug);
  const envFile = serviceEnvFile(probe.slug);
  const dir = tool?.cwd;

  switch (probe.signature) {
    case 'port_conflict': {
      const free = (probe.port ?? 0) + 1;
      items.push({
        source: 'probe',
        title: `Port ${probe.port} is taken — move ${probe.slug} to ${free}`,
        description: `log shows EADDRINUSE on ${probe.port}.`,
        fix: `Set ${tool?.env ?? 'PORT'}=${free} in ${envFile ?? '.env'} and restart.`,
        apply: tool
          ? { type: 'env-set', envFile, key: tool.env ?? 'PORT', value: String(free) }
          : { type: 'env-set', envFile, key: 'PORT', value: String(free) },
      });
      items.push({
        source: 'probe',
        title: `Restart ${probe.slug}`,
        description: `after freeing the port, bring the service back up.`,
        apply: { type: 'restart', service: probe.slug },
      });
      break;
    }
    case 'missing_env':
      for (const key of probe.missingEnv.slice(0, 5)) {
        const value = process.env[key] ?? KNOWN_STUB_ENV[key] ?? `placeholder-${key.toLowerCase()}`;
        items.push({
          source: 'probe',
          title: `Set missing env ${key}`,
          description: `required by ${probe.slug} but unset.`,
          fix: `Set ${key} in ${envFile ?? '.env'} (reuse a real key from Draymond .env.local where available).`,
          apply: { type: 'env-set', envFile, key, value },
        });
      }
      break;
    case 'missing_deps':
    case 'workspace_ref':
      items.push({
        source: 'probe',
        title: `Install dependencies for ${probe.slug}`,
        description: 'dependency resolution failure in logs.',
        fix: dir ? `Run npm install in ${dir}` : 'install dependencies',
        apply: { type: 'preset', preset: 'install', dir },
      });
      break;
    case 'prisma_uninit':
      items.push({
        source: 'probe',
        title: `Regenerate Prisma client for ${probe.slug}`,
        description: '"did not initialize" — the generated client is missing/stale.',
        apply: { type: 'preset', preset: 'prisma-generate', dir },
      });
      break;
    case 'spawn_einval':
      items.push({
        source: 'probe',
        title: `Fix npm/npx spawn on Windows for ${probe.slug}`,
        description: 'spawn EINVAL — .cmd shims must run through cmd.exe.',
        fix: 'Route npm/npx invocations via execFile("cmd.exe", ["/d","/s","/c", ...]) on win32 (see Codegang completion-validator pattern).',
        apply: null, // needs a code patch → codegen step
      });
      break;
    case 'crash_loop':
    case 'not_started':
      items.push({
        source: 'probe',
        title: `Start ${probe.slug}`,
        description: 'not listening — crashed, failed to bind, or never started.',
        apply: { type: 'restart', service: probe.slug },
      });
      break;
    default:
      break;
  }
  return items;
}

/** Codegang local remediation: analyze a file + self-heal a directory. */
async function codegangRemediation(input: { path?: string; targetFile?: string }): Promise<RemediationItem[]> {
  const items: RemediationItem[] = [];
  const up = await codegangIsUp();
  if (!up) return items;

  if (input.path && !input.targetFile) {
    // heal the directory — the self-healing pipeline produces code patches.
    const heal = await codegangHealProject(input.path);
    for (const action of heal.actions) {
      const file = action.filePath ?? input.path;
      const find = (action.originalContent ?? '').trim();
      const replace = (action.proposedContent ?? '').trim();
      const isAuto = action.type === 'auto_fix' || action.type === 'guard_clause';
      const confident = typeof action.confidence === 'number' ? action.confidence >= 0.6 : true;
      const patchable = isAuto && confident && find.length > 0 && replace.length > 0 && find !== replace;
      items.push({
        source: 'codegang',
        severity: action.type === 'rollback' ? 'high' : 'medium',
        title: action.description ?? `heal: ${file}`,
        description: `${action.type ?? 'fix'} (confidence ${action.confidence ?? 'n/a'})`,
        file,
        fix: replace ? 'apply the proposed content' : 'inspect and fix',
        apply: patchable ? { type: 'patch', file, find, replace } : null,
        confidence: action.confidence,
      });
    }
  }

  if (input.targetFile && input.path) {
    const file = input.targetFile.startsWith(input.path) ? input.targetFile : `${input.path.replace(/\\/g, '/').replace(/\/$/, '')}/${input.targetFile}`;
    try {
      const res = await codegangAnalyzeFile({ filePath: file, content: '' }); // content-less → Codegang reads from disk
      for (const f of res.findings ?? []) {
        if (!f.fixSuggestion) continue;
        items.push({
          source: 'codegang',
          severity: f.severity,
          title: f.title ?? 'finding',
          description: f.description,
          file,
          fix: f.fixSuggestion,
          apply: null,
        });
      }
    } catch {
      // skip unreadable target
    }
  }
  return items;
}

/** RepoRank + Grader informational remediation when a repo URL is known. */
async function repoRemediation(repoUrl: string): Promise<RemediationItem[]> {
  const items: RemediationItem[] = [];
  const [reporank, grader] = await Promise.all([
    scoreWithReporank('repair', repoUrl).catch(() => ({ scorer: 'reporank' as string, score: null as number | null, summary: '' })),
    scoreWithGrader('repair', repoUrl).catch(() => ({ scorer: 'grader' as string, score: null as number | null, summary: '' })),
  ]);
  if (typeof reporank.score === 'number') {
    items.push({ source: 'reporank', severity: reporank.score < 60 ? 'high' : 'info', title: `RepoRank score ${reporank.score}`, description: reporank.summary, apply: null });
  }
  if (typeof grader.score === 'number') {
    items.push({ source: 'grader', severity: grader.score < 60 ? 'high' : 'info', title: `Grader score ${grader.score}`, description: grader.summary, apply: null });
  }
  return items;
}

/**
 * Collect remediation for a repair target from every reachable engine.
 * Never throws.
 */
export async function collectRemediation(input: {
  path?: string;
  repoUrl?: string;
  targetFile?: string;
  probe?: ServiceDiagnosis;
}): Promise<{ items: RemediationItem[]; sources: string[] }> {
  const items: RemediationItem[] = [];
  const sources = new Set<string>();

  if (input.probe) {
    items.push(...opsRemediation(input.probe));
    sources.add('probe');
  }
  if (input.path) {
    const codegang = await codegangRemediation(input).catch(() => []);
    items.push(...codegang);
    if (codegang.length > 0) sources.add('codegang');
  }
  if (input.repoUrl) {
    const repo = await repoRemediation(input.repoUrl).catch(() => []);
    items.push(...repo);
    if (repo.length > 0) sources.add('reporank');
    if (repo.length > 0) sources.add('grader');
  }
  return { items, sources: [...sources] };
}
