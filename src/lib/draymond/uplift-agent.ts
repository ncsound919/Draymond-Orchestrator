// ============================================================================
// DRAYMOND — Uplift Guide Agent Registration
// Ensures the Uplift Guide chat agent is registered in Draymond's agent table.
// Uses an in-memory cache with TTL to avoid hitting the DB on every chat request.
// ============================================================================

import { createDraymondClient } from './client';
import type { DraymondAgent } from './types';

const UPLIFT_GUIDE_SLUG = 'uplift-guide';

// Cache with TTL — revalidate every 5 minutes
let cachedAgentId: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Mutex: prevents concurrent registration race conditions
let registrationPromise: Promise<string> | null = null;

/**
 * Ensure the Uplift Guide agent is registered in Draymond.
 * Creates it on first call, returns cached ID on subsequent calls.
 * Uses a mutex to prevent duplicate inserts from concurrent requests.
 */
export async function ensureUpliftGuideAgent(): Promise<string> {
  // Return cached value if still fresh
  if (cachedAgentId && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedAgentId;
  }

  // If another request is already registering, wait for it
  if (registrationPromise) {
    return registrationPromise;
  }

  // Acquire the mutex
  registrationPromise = doEnsureAgent();
  try {
    const result = await registrationPromise;
    return result;
  } finally {
    registrationPromise = null;
  }
}

async function doEnsureAgent(): Promise<string> {
  const supabase = await createDraymondClient();

  // Check if already registered
  const { data: existing } = await supabase
    .from('draymond_agents')
    .select('id')
    .eq('slug', UPLIFT_GUIDE_SLUG)
    .single();

  if (existing) {
    cachedAgentId = (existing as { id: string }).id;
    cacheTimestamp = Date.now();
    return cachedAgentId;
  }

  // Register for the first time
  const { data: created, error } = await supabase
    .from('draymond_agents')
    .insert({
      name: 'Uplift Guide',
      slug: UPLIFT_GUIDE_SLUG,
      description:
        'The Uplift Lab community AI assistant. Helps members navigate resources across education, health, wealth, ventures, justice, and community domains.',
      version: '1.0.0',
      capabilities: ['chat'],
      model_provider: 'openai',
      model_id: 'gpt-4o-mini',
      config: {
        max_tokens: 500,
        temperature: 0.7,
        system_prompt_version: '1.0',
      },
      status: 'active',
      heartbeat_interval_seconds: 300,
      max_consecutive_errors: 5,
      confidence_threshold_auto: 0.75,
      confidence_threshold_review: 0.4,
      max_retries: 2,
      retry_backoff_ms: 1000,
      auto_recovery_enabled: true,
    })
    .select('id')
    .single();

  if (error) {
    // Handle unique constraint violation (another request won the race)
    if (error.code === '23505') {
      const { data: raceWinner } = await supabase
        .from('draymond_agents')
        .select('id')
        .eq('slug', UPLIFT_GUIDE_SLUG)
        .single();
      
      if (raceWinner) {
        cachedAgentId = (raceWinner as { id: string }).id;
        cacheTimestamp = Date.now();
        return cachedAgentId;
      }
    }
    throw new Error(`Failed to register Uplift Guide agent: ${error.message}`);
  }

  cachedAgentId = (created as { id: string }).id;
  cacheTimestamp = Date.now();
  return cachedAgentId;
}

/**
 * Get the full agent record (for admin/debug purposes)
 */
export async function getUpliftGuideAgent(): Promise<DraymondAgent | null> {
  const supabase = await createDraymondClient();

  const { data } = await supabase
    .from('draymond_agents')
    .select('*')
    .eq('slug', UPLIFT_GUIDE_SLUG)
    .single();

  return data as DraymondAgent | null;
}
