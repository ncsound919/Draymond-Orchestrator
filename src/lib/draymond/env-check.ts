/**
 * Environment variable validation for Draymond Orchestrator.
 *
 * Called at startup via instrumentation.ts. Logs warnings for missing
 * vars but never throws — optional features degrade gracefully.
 */

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
}

const REQUIRED_VARS: EnvVar[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', required: true, description: 'Supabase project URL' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', required: true, description: 'Supabase anonymous key' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, description: 'Supabase service role key (server-only)' },
  { name: 'CRON_SECRET', required: true, description: 'Bearer token for cron/admin API routes' },
];

const OPTIONAL_VARS: EnvVar[] = [
  { name: 'NTFY_URL', required: false, description: 'ntfy server URL for the push-approval relay (e.g. https://ntfy.sh)' },
  { name: 'NTFY_TOPIC', required: false, description: 'ntfy topic for approval notifications' },
  { name: 'DRAYMOND_PUBLIC_URL', required: false, description: 'Public base URL for ntfy Approve/Reject callbacks' },
  { name: 'OPENAI_API_KEY', required: false, description: 'OpenAI API key for swarm decomposition' },
  { name: 'ANTHROPIC_API_KEY', required: false, description: 'Anthropic API key for Claude calls' },
  { name: 'QWEN_API_KEY', required: false, description: 'Qwen API key for Uplift Guide AI' },
  { name: 'NEWSAPI_KEY', required: false, description: 'NewsAPI key for news fetching' },
  { name: 'GNEWS_API_KEY', required: false, description: 'GNews API key' },
  { name: 'WORLDNEWS_API_KEY', required: false, description: 'WorldNews API key' },
  { name: 'GMAIL_USER', required: false, description: 'Gmail address for email notifications' },
  { name: 'GMAIL_APP_PASSWORD', required: false, description: 'Gmail app password for SMTP' },
  { name: 'DRAYMOND_ALERT_EMAIL', required: false, description: 'Alert recipient email' },
  { name: 'NTFY_URL', required: false, description: 'ntfy server base URL (push-approval relay)' },
  { name: 'NTFY_TOPIC', required: false, description: 'ntfy topic for approval requests' },
  { name: 'DRAYMOND_PUBLIC_URL', required: false, description: 'Public URL for ntfy approval action callbacks' },
  { name: 'UPLIFT_BASE_URL', required: false, description: 'Uplift Agent base URL' },
  { name: 'SPORTS_STEVE_URL', required: false, description: 'Sports Steve agent URL' },
  { name: 'BET_BUDDY_URL', required: false, description: 'Bet Buddy agent URL' },
  { name: 'SOCIAL_MEDIA_URL', required: false, description: 'Social Media Dashboard URL' },
  { name: 'OMNI_RESEARCH_URL', required: false, description: 'OmniResearch Pro URL' },
  { name: 'INDY_MUSIC_URL', required: false, description: 'Indy Music Platform URL' },
  { name: 'MEGACODE_URL', required: false, description: 'MegaCode/OverCoat URL' },
  { name: 'OVERLAY_CHAIN_URL', required: false, description: 'Overlay Chain URL' },
  { name: 'CCE_ROOT', required: false, description: 'Claude Code Extension root directory' },
  { name: 'CCE_PYTHON', required: false, description: 'Python binary for CCE' },
  { name: 'TRADING_AGENTS_PYTHON', required: false, description: 'Python binary for TradingAgents' },
  { name: 'TRADING_AGENTS_DIR', required: false, description: 'TradingAgents project directory' },
  { name: 'SUB_TEAM_PYTHON', required: false, description: 'Python binary for Sub Team' },
  { name: 'SUB_TEAM_DIR', required: false, description: 'Sub Team project directory' },
  { name: 'DRAYMOND_REGISTRY_DIR', required: false, description: 'File-based registry directory' },
  { name: 'AUDIT_LOG_PATH', required: false, description: 'Audit log file path' },
];

/**
 * Validate environment variables and log results.
 * Returns { ok: boolean; missing: string[] } for required vars.
 */
export function checkEnv(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const v of REQUIRED_VARS) {
    if (!process.env[v.name]) {
      missing.push(v.name);
    }
  }

  for (const v of OPTIONAL_VARS) {
    if (!process.env[v.name]) {
      warnings.push(`  - ${v.name}: ${v.description}`);
    }
  }

  // ── Log results ──────────────────────────────────────────────────────────
  if (missing.length > 0) {
    console.error(
      `[Draymond] MISSING REQUIRED env vars:\n${missing.map((n) => `  - ${n}`).join('\n')}\n` +
        `Set them in .env.local — see .env.example for reference.`
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `[Draymond] Optional env vars not set (features will be disabled):\n${warnings.join('\n')}`
    );
  }

  if (missing.length === 0 && warnings.length === 0) {
    console.log('[Draymond] All environment variables are set.');
  } else if (missing.length === 0) {
    console.log('[Draymond] All required environment variables are set.');
  }

  return { ok: missing.length === 0, missing };
}
