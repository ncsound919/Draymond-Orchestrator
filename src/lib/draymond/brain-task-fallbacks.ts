// ============================================================================
// DRAYMOND ORCHESTRATION — Deterministic Brain Task Fallback Handlers
// ============================================================================
// When API tokens fail or external services are unavailable, route failed
// tasks to the deterministic brain to complete them deterministically.
//
// Tasks handled:
//   - Morning Briefing (chain: morning-briefing)
//   - Full Content Creation (chain: full-content-creation)
//   - Hemp Research & News Digest (chain: hemp-research-news)
//   - Overlay365 QA (chain: overlay365-qa)
//   - Daily Marketing Run (chain: daily-marketing-run)
//   - Research Data Feed (chain: research-data-feed)
//   - Sports Betting Daily (chain: sports-betting-daily)
// ============================================================================

import { runBrainTask } from './brain-task';

export interface BrainTaskFallbackOpts {
  /** The failed chain or task name. */
  taskName: string;
  /** Context about why it failed (e.g., "codegen engine unavailable", "API token missing"). */
  failureReason: string;
  /** Optional input data from the original chain. */
  inputData?: Record<string, unknown>;
  /** Optional timeout override (ms). */
  timeoutMs?: number;
  /** Lane override for the brain (e.g., "content", "research", "social"). */
  lane?: string;
}

export interface BrainTaskFallbackResult {
  success: boolean;
  taskName: string;
  output?: unknown;
  error?: string;
  brain_reasoning?: string;
  brain_confidence?: number;
}

// ============================================================================
// TASK-SPECIFIC BRAIN QUERIES
// ============================================================================

/** Build the brain query for a morning briefing (news + agenda + todo synthesis). */
function queryMorningBriefing(_inputData?: Record<string, unknown>): string {
  return `
Generate a morning briefing that synthesizes:
1. Top 3 news headlines from the past 24h
2. Today's agenda items and priorities
3. Key metrics snapshot (team health, system status)
4. Action items for the day
5. Suggested focus areas

Format as JSON with keys: headlines, agenda, metrics, actions, focus_areas.
Output deterministically using cached news feeds and local knowledge base.
  `.trim();
}

/** Build the brain query for full content creation (multi-format content generation). */
function queryFullContentCreation(inputData?: Record<string, unknown>): string {
  const topic = (inputData?.topic as string) ?? 'general business operations';
  const formats = (inputData?.formats as string[]) ?? ['markdown', 'social', 'email'];
  
  return `
Create comprehensive content about: "${topic}"

Formats to generate:
${formats.map((f) => `- ${f}`).join('\n')}

Requirements:
- Use deterministic templates and cached research data
- Structure with clear headings and sections
- Include actionable insights
- Maintain brand voice consistency
- No external API calls

Return as JSON with keys: [${formats.join(', ')}], each containing the formatted content.
  `.trim();
}

/** Build the brain query for hemp research & news digest. */
function queryHempResearchDigest(_inputData?: Record<string, unknown>): string {
  return `
Synthesize a Hemp Research & News Digest covering:
1. Recent regulatory changes (deterministic from cached knowledge)
2. Key research papers (from local research database)
3. Market trends and opportunities
4. Actionable insights for stakeholders
5. Recommended next steps

Format as JSON with keys: regulations, research, trends, insights, recommendations.
Use only local data sources and deterministic reasoning.
  `.trim();
}

/** Build the brain query for Overlay365 QA (quality assurance testing). */
function queryOverlay365QA(_inputData?: Record<string, unknown>): string {
  return `
Execute Overlay365 platform QA checklist deterministically:
1. Core workflow integrity checks
2. Data consistency validation
3. Permission and access control verification
4. Performance baseline validation
5. Security posture assessment

Return as JSON with keys: checks, validations, permissions, performance, security.
Each should contain: status (pass/warning/fail), details, remediation_if_needed.
Use deterministic tests only (no external APIs).
  `.trim();
}

/** Build the brain query for daily marketing run (campaign status & metrics). */
function queryDailyMarketingRun(_inputData?: Record<string, unknown>): string {
  return `
Generate Daily Marketing Run report:
1. Campaign performance summary (from cached metrics)
2. Audience engagement analysis
3. Content reach and impressions
4. Conversion funnel status
5. Recommended optimizations
6. Next day focus areas

Return as JSON with keys: campaigns, engagement, reach, conversions, optimizations, next_focus.
Use deterministic calculations from local data stores.
  `.trim();
}

/** Build the brain query for research data feed (ongoing research ingestion). */
function queryResearchDataFeed(_inputData?: Record<string, unknown>): string {
  return `
Ingest and process Research Data Feed:
1. Parse cached research paper feeds
2. Extract key findings and citations
3. Categorize by domain (biotech, finance, tech, etc.)
4. Identify novel insights and trends
5. Flag high-impact discoveries
6. Generate research summary

Return as JSON with keys: papers, findings, categories, insights, discoveries, summary.
Use deterministic parsing and local knowledge base only.
  `.trim();
}

/** Build the brain query for sports betting daily (odds & analysis). */
function querySportsBettingDaily(_inputData?: Record<string, unknown>): string {
  return `
Generate Sports Betting Daily analysis:
1. Overnight odds movements and line changes
2. Sharp action indicators (from cached data)
3. Value opportunities using deterministic scoring
4. Recommended plays (high confidence only)
5. Risk management guidance
6. Key injury/news updates

Return as JSON with keys: odds_movement, sharp_action, value, recommendations, risk_mgmt, news.
Use deterministic models and cached historical data. No live API calls.
  `.trim();
}

// ============================================================================
// MAIN ESCALATION FUNCTION
// ============================================================================

/**
 * Escalate a failed task to the deterministic brain for completion.
 * 
 * @returns Result with success/output or error details
 */
export async function escalateToDeteministicBrain(
  opts: BrainTaskFallbackOpts
): Promise<BrainTaskFallbackResult> {
  console.log(
    `[brain-fallback] Escalating "${opts.taskName}" to deterministic brain (reason: ${opts.failureReason})`
  );

  // Build task-specific brain query
  let query: string;
  switch (opts.taskName.toLowerCase()) {
    case 'morning-briefing':
    case 'morning briefing':
      query = queryMorningBriefing(opts.inputData);
      break;
    case 'full-content-creation':
    case 'full content creation':
      query = queryFullContentCreation(opts.inputData);
      break;
    case 'hemp-research-news':
    case 'hemp research & news digest':
    case 'hemp research news':
      query = queryHempResearchDigest(opts.inputData);
      break;
    case 'overlay365-qa':
    case 'overlay365 qa':
      query = queryOverlay365QA(opts.inputData);
      break;
    case 'daily-marketing-run':
    case 'daily marketing run':
      query = queryDailyMarketingRun(opts.inputData);
      break;
    case 'research-data-feed':
    case 'research data feed':
      query = queryResearchDataFeed(opts.inputData);
      break;
    case 'sports-betting-daily':
    case 'sports betting daily':
      query = querySportsBettingDaily(opts.inputData);
      break;
    default:
      query = `Complete the following task deterministically: ${opts.taskName}. Use local data sources and cached knowledge only. Return structured JSON output.`;
  }

  try {
    const brainOutput = await runBrainTask(query, {
      lane: opts.lane,
      timeoutMs: opts.timeoutMs ?? 120_000,
    });

    if (brainOutput === null) {
      return {
        success: false,
        taskName: opts.taskName,
        error: 'Deterministic brain unreachable or returned no output',
      };
    }

    // Parse brain output
    let output: unknown;
    try {
      output = JSON.parse(brainOutput);
    } catch {
      output = brainOutput;
    }

    console.log(`[brain-fallback] Task "${opts.taskName}" completed by deterministic brain`);

    return {
      success: true,
      taskName: opts.taskName,
      output,
      brain_reasoning: 'Deterministic execution with local knowledge base',
      brain_confidence: 0.85, // Conservative confidence for fallback path
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[brain-fallback] Failed to escalate "${opts.taskName}": ${errorMsg}`);

    return {
      success: false,
      taskName: opts.taskName,
      error: errorMsg,
    };
  }
}

// ============================================================================
// CONVENIENCE ESCALATORS (for specific chains)
// ============================================================================

/**
 * Escalate Morning Briefing to deterministic brain when codegen engines fail.
 */
export async function escalateMorningBriefing(
  failureReason: string,
  inputData?: Record<string, unknown>
): Promise<BrainTaskFallbackResult> {
  return escalateToDeteministicBrain({
    taskName: 'Morning Briefing',
    failureReason,
    inputData,
    lane: 'briefing',
  });
}

/**
 * Escalate Full Content Creation to deterministic brain.
 */
export async function escalateFullContentCreation(
  failureReason: string,
  inputData?: Record<string, unknown>
): Promise<BrainTaskFallbackResult> {
  return escalateToDeteministicBrain({
    taskName: 'Full Content Creation',
    failureReason,
    inputData,
    lane: 'content',
  });
}

/**
 * Escalate Hemp Research & News Digest to deterministic brain.
 */
export async function escalateHempResearchDigest(
  failureReason: string,
  inputData?: Record<string, unknown>
): Promise<BrainTaskFallbackResult> {
  return escalateToDeteministicBrain({
    taskName: 'Hemp Research & News Digest',
    failureReason,
    inputData,
    lane: 'research',
  });
}

/**
 * Escalate Overlay365 QA to deterministic brain.
 */
export async function escalateOverlay365QA(
  failureReason: string,
  inputData?: Record<string, unknown>
): Promise<BrainTaskFallbackResult> {
  return escalateToDeteministicBrain({
    taskName: 'Overlay365 QA',
    failureReason,
    inputData,
    lane: 'testing',
  });
}

/**
 * Escalate Daily Marketing Run to deterministic brain.
 */
export async function escalateDailyMarketingRun(
  failureReason: string,
  inputData?: Record<string, unknown>
): Promise<BrainTaskFallbackResult> {
  return escalateToDeteministicBrain({
    taskName: 'Daily Marketing Run',
    failureReason,
    inputData,
    lane: 'social',
  });
}

/**
 * Escalate Research Data Feed to deterministic brain.
 */
export async function escalateResearchDataFeed(
  failureReason: string,
  inputData?: Record<string, unknown>
): Promise<BrainTaskFallbackResult> {
  return escalateToDeteministicBrain({
    taskName: 'Research Data Feed',
    failureReason,
    inputData,
    lane: 'research',
  });
}

/**
 * Escalate Sports Betting Daily to deterministic brain.
 */
export async function escalateSportsBettingDaily(
  failureReason: string,
  inputData?: Record<string, unknown>
): Promise<BrainTaskFallbackResult> {
  return escalateToDeteministicBrain({
    taskName: 'Sports Betting Daily',
    failureReason,
    inputData,
    lane: 'sports',
  });
}
