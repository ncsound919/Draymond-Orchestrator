// ============================================================================
// DETERMINISTIC BRAIN FALLBACK SYSTEM — Integration Guide
// ============================================================================
// When API tokens expire or external services are unavailable, the Draymond
// orchestrator automatically routes failed tasks to the deterministic brain
// for zero-LLM completion.
//
// This file documents the integration, configuration, and usage patterns.
// ============================================================================

// OVERVIEW
// ============================================================================
// The system consists of 3 components:
//
// 1. BRAIN-TASK-FALLBACKS (src/lib/draymond/brain-task-fallbacks.ts)
//    - Task-specific brain queries for each failed chain
//    - Escalation functions (escalateMorningBriefing, etc.)
//    - Deterministic task completion via the brain
//
// 2. CHAIN-EXECUTION-FALLBACK (src/lib/draymond/chain-execution-fallback.ts)
//    - Error classification (token, service, other)
//    - Chain execution wrapper with automatic brain fallback
//    - Batch chain executor for daily batch jobs
//    - Statistics and reporting
//
// 3. FALLBACK-REGISTRY (src/lib/draymond/fallback-registry.ts)
//    - Chain-specific fallback entries (registered automatically)
//    - Integration with existing LLM fallback system
//    - Covered chains: morning-briefing, full-content-creation, etc.

// ARCHITECTURE
// ============================================================================
//
//   Chain Execution
//   ↓
//   ├─→ [Success] ✓
//   ├─→ [Error]
//       ├─→ Error Classification (classifyTokenError)
//       │   ├─→ MISSING_API_KEY → Escalate
//       │   ├─→ MISSING_OAUTH_TOKEN → Escalate
//       │   ├─→ EXPIRED_TOKEN → Escalate
//       │   ├─→ INVALID_CREDENTIALS → Escalate
//       │   ├─→ RATE_LIMITED → Escalate
//       │   ├─→ SERVICE_UNAVAILABLE → Escalate
//       │   └─→ Other → Fail
//       ├─→ Escalate to Deterministic Brain
//           ├─→ /task endpoint (general tasks)
//           ├─→ /research/publish endpoint (research papers)
//           └─→ Returns structured JSON output
//       └─→ Complete Chain
//

// INTEGRATION POINTS
// ============================================================================
//
// 1. IN REPAIR-TEAM (src/lib/draymond/repair-team.ts)
//    
//    When repair-team detects a chain failure:
//    
//    ```typescript
//    import { executeChainWithBrainFallback } from './chain-execution-fallback';
//    
//    // In the repair handler:
//    const result = await executeChainWithBrainFallback({
//      chain: failedChain,
//      error: originalError,
//      inputData: chainInput,
//    });
//    
//    if (result.fallback_used) {
//      console.log(`Task completed via deterministic brain: ${result.chain_name}`);
//      await recordRepairSuccess(chain.id, 'brain_escalation');
//    }
//    ```
//
// 2. IN CHAIN EXECUTION (src/lib/draymond/chains.ts or similar)
//    
//    When executing daily chains in batch:
//    
//    ```typescript
//    import { executeChainBatchWithBrainFallback } from './chain-execution-fallback';
//    
//    const results = await executeChainBatchWithBrainFallback(
//      chains,
//      async (chain) => {
//        // Your normal chain executor
//        return executeChain(chain);
//      },
//      { parallelism: 3, continueOnError: true }
//    );
//    
//    // Analyze results
//    const stats = analyzeBrainFallbackStats(results);
//    console.log(`Success rate: ${(stats.fallback_success_rate * 100).toFixed(1)}%`);
//    ```
//
// 3. IN DAY-ORCHESTRATOR (src/lib/draymond/day-orchestrator.ts)
//    
//    At startup of daily chain cycle:
//    
//    ```typescript
//    import {
//      escalateMorningBriefing,
//      escalateDailyMarketingRun,
//    } from './brain-task-fallbacks';
//    
//    // When morning-briefing fails:
//    const result = await escalateMorningBriefing(
//      'API token missing (OPENCODE_API_KEY not set)',
//      { /* input data */ }
//    );
//    ```

// SUPPORTED CHAINS & FALLBACK HANDLERS
// ============================================================================
//
// Chain                      Handler                    Lane        Status
// ─────────────────────────  ────────────────────────   ───────     ──────
// morning-briefing           escalateMorningBriefing    briefing    ✓
// full-content-creation      escalateFullContentCreation content    ✓
// hemp-research-news         escalateHempResearchDigest research    ✓
// overlay365-qa              escalateOverlay365QA       testing     ✓
// daily-marketing-run        escalateDailyMarketingRun  social      ✓
// research-data-feed         escalateResearchDataFeed   research    ✓
// sports-betting-daily       escalateSportsBettingDaily sports      ✓
//

// ERROR CLASSIFICATION
// ============================================================================
//
// The system automatically classifies errors to decide whether to escalate:
//
// Token-Related Errors (→ Escalate to Brain)
//   - MISSING_API_KEY: env var OPENCODE_API_KEY, GEMINI_API_KEY, etc. not set
//   - MISSING_OAUTH_TOKEN: Google OAuth token file missing or empty
//   - EXPIRED_TOKEN: Token has expired, requires refresh
//   - INVALID_CREDENTIALS: Auth credentials provided but rejected by service
//
// Service Errors (→ Escalate to Brain)
//   - RATE_LIMITED: HTTP 429 or rate limit error
//   - SERVICE_UNAVAILABLE: HTTP 503 or service not responding
//
// Other Errors (→ Fail, No Escalation)
//   - Database errors
//   - Validation errors
//   - Logic errors
//   - Unclassified errors
//

// CONFIGURATION
// ============================================================================
//
// Environment Variables:
//   - BRAIN_URL: URL to deterministic brain (e.g., http://localhost:3210)
//                Required for brain fallback to work
//   - NOTIFICATION_LOG_DIR: Where to store fallback notification logs
//                           Default: ~/.draymond/notifications-fallback
//
// When BRAIN_URL is not set:
//   - Brain fallback is disabled
//   - Chain failures are still routed to brain but will fail immediately
//   - No network calls are attempted

// MONITORING & OBSERVABILITY
// ============================================================================
//
// Statistics are automatically collected and available via:
//
// ```typescript
// import { analyzeBrainFallbackStats } from './chain-execution-fallback';
// const stats = analyzeBrainFallbackStats(results);
//
// stats.total_chains          // Total chains in batch
// stats.successful            // Successful completions (normal or brain)
// stats.failed                // Failures (no fallback or fallback failed)
// stats.fallback_used         // Chains that used brain fallback
// stats.fallback_success_rate // % of fallback attempts that succeeded
// stats.avg_brain_confidence  // Average confidence score of brain outputs
// ```
//
// Log output includes:
//   - "[brain-fallback] Escalating "..." to deterministic brain
//   - "[chain-fallback] Escalating chain "..." to deterministic brain
//   - "[chain-fallback] Chain execution result: success/failure"

// DETERMINISTIC BRAIN OUTPUTS
// ============================================================================
//
// The brain always returns deterministic outputs in JSON format:
//
// Morning Briefing:
//   {
//     "headlines": [...],
//     "agenda": [...],
//     "metrics": {...},
//     "actions": [...],
//     "focus_areas": [...]
//   }
//
// Full Content Creation:
//   {
//     "markdown": "...",
//     "social": "...",
//     "email": "..."
//   }
//
// Research Data Feed:
//   {
//     "papers": [...],
//     "findings": [...],
//     "categories": {...},
//     "insights": [...],
//     "discoveries": [...],
//     "summary": "..."
//   }
//
// All outputs include structured JSON suitable for downstream consumers
// (databases, APIs, report generators, etc.)

// TESTING & VALIDATION
// ============================================================================
//
// Unit Test Example:
//
// ```typescript
// import { classifyTokenError, executeChainWithBrainFallback } from './chain-execution-fallback';
//
// describe('deterministic brain fallback', () => {
//   it('classifies missing API key errors', () => {
//     const err = new Error('Missing env var: OPENCODE_API_KEY');
//     expect(classifyTokenError(err))
//       .toBe(TokenErrorType.MISSING_API_KEY);
//   });
//
//   it('escalates token errors to brain', async () => {
//     const result = await executeChainWithBrainFallback({
//       chain: { id: '123', name: 'Morning Briefing' },
//       error: new Error('OPENCODE_API_KEY not found'),
//     });
//     expect(result.fallback_used).toBe(true);
//     expect(result.success).toBe(true || false); // Depends on brain
//   });
//
//   it('does not escalate logic errors', async () => {
//     const result = await executeChainWithBrainFallback({
//       chain: { id: '123', name: 'Morning Briefing' },
//       error: new Error('Invalid input format'),
//     });
//     expect(result.fallback_used).toBe(false);
//   });
// });
// ```

// OPERATIONS & TROUBLESHOOTING
// ============================================================================
//
// Issue: "Brain fallback not working"
// Debug:
//   1. Check BRAIN_URL env var is set: `echo $env:BRAIN_URL`
//   2. Check brain is running: `curl http://localhost:3210/health`
//   3. Check logs for "[brain-fallback]" messages
//   4. Verify error is classified as token/service error
//
// Issue: "Chain completed but output is empty"
// Debug:
//   1. Check brain returned valid JSON
//   2. Check output parsing didn't fail
//   3. Check downstream consumer expects JSON
//
// Issue: "Too many chains escalating to brain"
// Optimize:
//   1. Provide missing API tokens (solve root cause)
//   2. Check if service is actually unavailable (capacity issue?)
//   3. Increase brain timeout if network is slow
//   4. Monitor brain load with `GET /health` endpoint
//

// FUTURE ENHANCEMENTS
// ============================================================================
//
// - Brain confidence scoring (0.0–1.0 for each output)
// - Adaptive retry strategy (exponential backoff)
// - Brain load tracking and circuit breaker
// - Multi-brain failover (redundancy)
// - Caching of deterministic outputs (dedup identical tasks)
// - Analytics dashboard showing fallback patterns
// - Automatic token refresh integration
//

export {};
