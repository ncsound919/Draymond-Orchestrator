// ============================================================================
// DRAYMOND — Fallback Registry Entries
// ============================================================================
// Single source of truth for "what does this LLM function output when the whole
// LLM chain is down?" Imported once (by bootstrap/index) to register every LLM
// function the fleet knows about plus its deterministic resolver.
//
// Coverage: declareLlmFunction() + registerFallback() keep the denominator and
// numerator in sync, so getFallbackCoverage() reports the true %.
// ============================================================================

import {
  declareLlmFunction,
  registerFallback,
  template,
  computed,
  brainFallback,
  type FallbackContext,
  type BrainResolver,
} from './fallbacks';

/** Async brain escalation helper: finish the degraded task via /task. */
function brain(queryFrom: (ctx: FallbackContext) => string): BrainResolver {
  return async (ctx) => {
    const { runBrainTask } = await import('./brain-task');
    return runBrainTask(queryFrom(ctx));
  };
}

// ---------------------------------------------------------------------------
// chat.ts
// ---------------------------------------------------------------------------

declareLlmFunction('chat.compressConversation');
registerFallback(
  'chat.compressConversation',
  computed('chat compress — keep tail, note truncation', (ctx) => {
    const tail = String((ctx.userMessage as string | undefined) ?? '').slice(-1200);
    return `[Earlier conversation omitted — summarizer unavailable. Retained tail:] ${tail}`;
  })
);

declareLlmFunction('chat.handleGeneralChat');
registerFallback(
  'chat.handleGeneralChat',
  template(
    'general chat — honest degraded reply',
    "I'm sorry — my language services are temporarily unavailable, so I can't give you a full answer right now. Your message was received, and I'll be back to full strength shortly. If it's urgent, try a status or entity question (those still work)."
  )
);

declareLlmFunction('chat.querySystemStatus');
registerFallback(
  'chat.querySystemStatus',
  template(
    'status query — honest degraded reply',
    'Live system status is temporarily unavailable while language services recover. Please retry in a few minutes.'
  )
);

declareLlmFunction('chat.handleDiagnostic');
registerFallback(
  'chat.handleDiagnostic',
  template(
    'diagnostic — honest degraded reply',
    'Deep diagnostics are temporarily unavailable. Please retry shortly; service health checks still run on their normal schedule.'
  )
);

declareLlmFunction('chat.synthesizeSearchAnswer');
registerFallback(
  'chat.synthesizeSearchAnswer',
  computed('search — degrade to raw source list', (ctx) => {
    const src = String((ctx.sources as string | undefined) ?? '').trim();
    return src ? `Search synthesis unavailable. Raw results:\n${src}` : 'Search synthesis temporarily unavailable.';
  })
);

// ---------------------------------------------------------------------------
// chat-polish.ts
// ---------------------------------------------------------------------------

declareLlmFunction('chat-polish.llmSummarize');
registerFallback(
  'chat-polish.llmSummarize',
  template('chat polish — empty (caller renders JSON lines)', '')
);

// ---------------------------------------------------------------------------
// chain-builder.ts
// ---------------------------------------------------------------------------

declareLlmFunction('chain-builder.generateBlueprint');
registerFallback(
  'chain-builder.generateBlueprint',
  brainFallback(
    'blueprint — brain escalation → minimal deterministic chain',
    brain((ctx) => String((ctx.userMessage as string | undefined) ?? '')),
    computed('blueprint — minimal deterministic chain', (ctx) => {
      const desc = String((ctx.userMessage as string | undefined) ?? '').slice(0, 120);
      return JSON.stringify({
        description: desc,
        steps: [
          {
            id: 'step-1',
            type: 'task',
            description: `Handle: ${desc || 'request'}`,
            mapping: { kind: 'chat', slug: 'draymond-general' },
          },
        ],
        note: 'Generated deterministically (LLM unavailable).',
      });
    })
  )
);

// ---------------------------------------------------------------------------
// cognition.ts
// ---------------------------------------------------------------------------

declareLlmFunction('cognition.callDeepLLM');
registerFallback(
  'cognition.callDeepLLM',
  brainFallback(
    'deep plan — brain escalation → minimal plan artifact',
    brain((ctx) => String((ctx.userMessage as string | undefined) ?? '')),
    computed('deep plan — minimal plan artifact', (ctx) => {
      const task = String((ctx.userMessage as string | undefined) ?? '').slice(0, 140);
      return JSON.stringify({
        goals: [task || 'Process request'],
        phases: ['analyze', 'plan', 'execute'],
        steps: ['Decompose request', 'Assign owner', 'Verify outcome'],
        changes: [],
        dependencies: [],
        risks: ['Plan generated deterministically — review before executing.'],
        verification: ['Confirm output matches the request.'],
        tokenEstimate: 0,
      });
    })
  )
);

declareLlmFunction('cognition.deepenLoop');
registerFallback(
  'cognition.deepenLoop',
  brainFallback(
    'deepen loop — brain escalation → minimal plan artifact',
    brain((ctx) => String((ctx.userMessage as string | undefined) ?? '')),
    computed('deepen loop — minimal plan artifact', (ctx) => {
      const task = String((ctx.userMessage as string | undefined) ?? '').slice(0, 140);
      return JSON.stringify({
        goals: [task || 'Process request'],
        phases: ['analyze', 'plan', 'execute'],
        steps: ['Decompose request', 'Assign owner', 'Verify outcome'],
        changes: [],
        dependencies: [],
        risks: ['Plan generated deterministically — review before executing.'],
        verification: ['Confirm output matches the request.'],
        tokenEstimate: 0,
      });
    })
  )
);

// ---------------------------------------------------------------------------
// router.ts
// ---------------------------------------------------------------------------

declareLlmFunction('router.routeTask');
registerFallback(
  'router.routeTask',
  brainFallback(
    'router — brain escalation → unknown-route fallback',
    brain((ctx) => String((ctx.userMessage as string | undefined) ?? '')),
    computed('router — unknown-route fallback', (ctx) => {
      const task = String((ctx.userMessage as string | undefined) ?? '').slice(0, 120);
      return JSON.stringify({
        intent: 'unknown',
        confidence: 0,
        reasoning: `Routing unavailable (LLM degraded). Matched nothing deterministically for: ${task}`,
        alternatives: [],
        entity_slug: null,
        chain_slug: null,
      });
    })
  )
);

declareLlmFunction('router.tryLocalRoute');
registerFallback(
  'router.tryLocalRoute',
  computed('local router — unknown-route fallback', (ctx) => {
    const task = String((ctx.userMessage as string | undefined) ?? '').slice(0, 120);
    return JSON.stringify({
      intent: 'unknown',
      confidence: 0,
      reasoning: `Local routing unavailable for: ${task}`,
      alternatives: [],
      entity_slug: null,
      chain_slug: null,
    });
  })
);

// ---------------------------------------------------------------------------
// ultraplan.ts
// ---------------------------------------------------------------------------

declareLlmFunction('ultraplan.processUltraplan');
registerFallback(
  'ultraplan.processUltraplan',
  brainFallback(
    'ultraplan — brain escalation → minimal plan artifact',
    brain((ctx) => String((ctx.userMessage as string | undefined) ?? '')),
    computed('ultraplan — minimal plan artifact', (ctx) => {
      const task = String((ctx.userMessage as string | undefined) ?? '').slice(0, 140);
      return JSON.stringify({
        goals: [task || 'Process request'],
        phases: ['analyze', 'plan', 'execute'],
        steps: ['Decompose request', 'Assign owner', 'Verify outcome'],
        changes: [],
        dependencies: [],
        risks: ['Plan generated deterministically — review before executing.'],
        verification: ['Confirm output matches the request.'],
        tokenEstimate: 0,
      });
    })
  )
);

// ---------------------------------------------------------------------------
// ide/session-manager.ts
// ---------------------------------------------------------------------------

declareLlmFunction('ide.decomposeToSteps');
registerFallback(
  'ide.decomposeToSteps',
  brainFallback(
    'IDE plan — brain escalation → single deterministic codegen step',
    brain((ctx) => String((ctx.userMessage as string | undefined) ?? '')),
    computed('IDE plan — single deterministic codegen step', (ctx) => {
      const goal = String((ctx.userMessage as string | undefined) ?? '').slice(0, 120);
      return JSON.stringify({
        steps: [
          {
            id: 'step-1',
            kind: 'codegen',
            agent: 'uplift',
            title: 'Handle request',
            prompt: goal || 'Process the goal with the uplift agent.',
            dependsOn: [],
          },
        ],
        note: 'Deterministic fallback plan (LLM unavailable).',
      });
    })
  )
);

declareLlmFunction('ide.generateCommitMessage');
registerFallback(
  'ide.generateCommitMessage',
  template('commit message — chore fallback', 'chore: automated change (commit-message service unavailable)')
);

// ---------------------------------------------------------------------------
// ide/opencode-client.ts
// ---------------------------------------------------------------------------

declareLlmFunction('ide.runOpencodeCodegen');
registerFallback(
  'ide.runOpencodeCodegen',
  template(
    'codegen — empty deterministic result',
    '{"result":"Codegen service temporarily unavailable. Re-run once language services recover.","ok":false}'
  )
);

// ---------------------------------------------------------------------------
// mathx/services.ts
// ---------------------------------------------------------------------------

const MATHX_FALLBACKS: Array<[string, string | ((ctx: FallbackContext) => string)]> = [
  ['mathx.mathChat', 'Math assistant temporarily unavailable. Please retry shortly.'],
  [
    'mathx.planMath',
    '{"engine":"compute","requires_code":false,"requires_chart":false,"requires_retrieval":false,"domain":"general","complexity":"low","summary":"Query planning temporarily unavailable — processing directly.","chain":["compute"]}',
  ],
  ['mathx.generateMathCode', '# codegen temporarily unavailable\nprint("LLM unavailable — deterministic fallback")'],
  ['mathx.verifyDerivation', '{"valid":false,"steps":[],"error":"Derivation verification temporarily unavailable."}'],
  [
    'mathx.runHypothesis',
    '{"conjecture":"Hypothesis generation temporarily unavailable.","test_code":"print(\"LLM unavailable\")","prediction":"","rationale":""}',
  ],
  [
    'mathx.refineHypothesis',
    '{"conjecture":"Hypothesis refinement temporarily unavailable.","test_code":"","prediction":"","rationale":""}',
  ],
  ['mathx.runAnalogies', '{"analogies":[],"note":"Analogy generation temporarily unavailable."}'],
  ['mathx.runDomainExpert', 'Domain expert temporarily unavailable. Please retry shortly.'],
  ['mathx.exportContent', (ctx: FallbackContext) => String((ctx.userMessage as string | undefined) ?? '')],
  ['mathx.extractLatex', '\\text{OCR temporarily unavailable — could not extract LaTeX.}'],
];

for (const [key, value] of MATHX_FALLBACKS) {
  declareLlmFunction(key);
  registerFallback(
    key,
    typeof value === 'function'
      ? computed(key, value)
      : template(key, value)
  );
}

// ---------------------------------------------------------------------------
// api routes
// ---------------------------------------------------------------------------

declareLlmFunction('api.swarm.decompose');
registerFallback(
  'api.swarm.decompose',
  brainFallback(
    'swarm decompose — brain escalation → single deterministic task',
    brain((ctx) => String((ctx.userMessage as string | undefined) ?? '')),
    computed('swarm decompose — single deterministic task', (ctx) => {
      const goal = String((ctx.userMessage as string | undefined) ?? '').slice(0, 120);
      return JSON.stringify({
        tasks: [
          {
            id: 'task-1',
            agent: 'uplift',
            description: goal || 'Handle the goal with the uplift agent.',
            dependsOn: [],
          },
        ],
        note: 'Deterministic fallback decomposition (LLM unavailable).',
      });
    })
  )
);

// ---------------------------------------------------------------------------
// Chain Task Fallbacks — Deterministic Brain Escalation
// ---------------------------------------------------------------------------
// When chains fail due to missing API tokens or service unavailability,
// escalate to the deterministic brain to complete the task.

import {
  escalateMorningBriefing,
  escalateFullContentCreation,
  escalateHempResearchDigest,
  escalateOverlay365QA,
  escalateDailyMarketingRun,
  escalateResearchDataFeed,
  escalateSportsBettingDaily,
} from './brain-task-fallbacks';

const CHAIN_TASK_FALLBACKS: Array<[string, BrainResolver]> = [
  [
    'chain.morning-briefing',
    async (ctx) =>
      (await escalateMorningBriefing('LLM chain failed', ctx as Record<string, unknown>)).output as string,
  ],
  [
    'chain.full-content-creation',
    async (ctx) =>
      (await escalateFullContentCreation('LLM chain failed', ctx as Record<string, unknown>)).output as string,
  ],
  [
    'chain.hemp-research-news',
    async (ctx) =>
      (await escalateHempResearchDigest('LLM chain failed', ctx as Record<string, unknown>)).output as string,
  ],
  [
    'chain.overlay365-qa',
    async (ctx) =>
      (await escalateOverlay365QA('LLM chain failed', ctx as Record<string, unknown>)).output as string,
  ],
  [
    'chain.daily-marketing-run',
    async (ctx) =>
      (await escalateDailyMarketingRun('LLM chain failed', ctx as Record<string, unknown>)).output as string,
  ],
  [
    'chain.research-data-feed',
    async (ctx) =>
      (await escalateResearchDataFeed('LLM chain failed', ctx as Record<string, unknown>)).output as string,
  ],
  [
    'chain.sports-betting-daily',
    async (ctx) =>
      (await escalateSportsBettingDaily('LLM chain failed', ctx as Record<string, unknown>)).output as string,
  ],
];

for (const [key, resolver] of CHAIN_TASK_FALLBACKS) {
  declareLlmFunction(key);
  registerFallback(key, {
    label: `${key} — deterministic brain escalation`,
    kind: 'brain',
    // Last resort when degraded AND the brain is unreachable. Must never look
    // like real output: callers and downstream graders treat this string as
    // the failure it is instead of shipping placeholder prose as a result.
    resolve: () =>
      `[chain-fallback:FAILED] "${key}" could not run: LLM chain down and deterministic brain unreachable. Task NOT completed.`,
    brain: resolver,
  });
}

// Research-paper generation + Global Lens publishing. In degraded mode this
// escalates to the brain's /research/publish endpoint, which sources findings
// (arXiv/news/Wikipedia) deterministically, renders the research-paper skill
// template, and POSTs to Global Lens /api/publish — no LLM involved.
declareLlmFunction('research.publish-paper');
registerFallback(
  'research.publish-paper',
  brainFallback(
    'research paper — brain escalation → deterministic paper + Global Lens publish',
    brain((ctx) => String((ctx.userMessage as string | undefined) ?? '')),
    template(
      'research paper — degraded notice',
      'Research-paper generation is temporarily unavailable while language services recover. The request was received; the deterministic brain will publish the paper to Overlay Global Lens once it is reachable.'
    )
  )
);

// The chat / v1/orchestrate / v1/chain-builder api routes delegate to the lib
// functions above (orchestrateChatTurn → chat.*, buildAndExecuteChain →
// chain-builder.*, routeAndClassify → router.*, humanizeResponse →
// chat-polish.*), so those call paths are covered transitively by their leaf
// fallback keys. No separate api.* entries needed — declaring them would
// double-count coverage for paths that never pass the key directly.

// ---------------------------------------------------------------------------
// llm.ts — vision subtask
// ---------------------------------------------------------------------------

declareLlmFunction('vision.callVisionSubtask');
registerFallback(
  'vision.callVisionSubtask',
  template(
    'vision — honest degraded reply when both local lane and cloud are down',
    'Vision analysis is temporarily unavailable (local Ollama lane and cloud vision providers unreachable). Continuing without image interpretation — please describe the image in text if possible.'
  )
);

/** Register everything at import time. Safe to call multiple times. */
export function installFallbackRegistry(): void {
  // All registrations happen at module load; this hook exists so the import
  // side-effect is explicit in bootstrap/index.
}

