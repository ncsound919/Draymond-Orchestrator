// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Chain Template Seed Data
// ============================================================================
// Pre-built chain templates for common Uplift Lab workflows.
// References entities by slug — looked up at seed time.
//
// Available chain templates:
//   1. ml-research-loop       — Autonomous ML experiment loop (AutoResearch)
//   2. cis-contract-workflow  — CIS contract generation and validation
// ============================================================================

import { createChain, addSteps } from './chains';
import { getEntity } from './registry';
import type { DraymondChain } from './types';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Look up an entity by slug, throwing a clear error if not found.
 * Entities must be seeded before chains can be built.
 */
async function requireEntityBySlug(slug: string): Promise<string> {
  const entity = await getEntity(slug);
  if (!entity) {
    throw new Error(
      `[Chains Seed] Entity "${slug}" not found in registry. Run entity seed first.`
    );
  }
  return entity.id;
}

// ============================================================================
// TEMPLATE DEFINITIONS
// ============================================================================

/**
 * Seed the ML Research Loop chain template.
 *
 * Workflow:
 *   Step 1 — Prepare data (autoresearch_prepare)
 *   Step 2 — Read config  (autoresearch_read_config)  [depends on step 1]
 *   Step 3 — Train model  (autoresearch_train)         [depends on step 2]
 *   Step 4 — Read results (autoresearch_read_results)  [depends on step 3]
 *   Step 5 — Read program (autoresearch_read_program)  [depends on step 4, optional analysis]
 */
async function seedMlResearchLoop(): Promise<DraymondChain> {
  const autoResearchId = await requireEntityBySlug('ext-autoresearch');

  const chain = await createChain({
    name: 'ML Research Loop',
    slug: 'tpl-ml-research-loop',
    description:
      'Autonomous ML experiment loop (Karpathy-style). Prepares data, reads config, runs GPU training, reads results, and reads the research program. Requires NVIDIA GPU + CUDA 12.8.',
    version: '1.0.0',
    is_template: true,
    status: 'draft',
    trigger_type: 'manual',
    input_data: {
      // Defaults — override at instantiation time
      experiment_name: 'experiment_001',
      data_path: null,
      config_overrides: {},
    },
    context: {},
    max_retries: 1,
  });

  // Insert all steps first (without depends_on_steps — will be set after IDs are known)
  const steps = await addSteps([
    {
      chain_id: chain.id,
      step_order: 1,
      name: 'Prepare Data',
      description: 'Run autoresearch_prepare to stage the dataset for training.',
      entity_id: autoResearchId,
      action: 'autoresearch_prepare',
      input_mapping: {
        data_path: '$.input.data_path',
        experiment_name: '$.input.experiment_name',
      },
      output_key: 'prepare',
      depends_on_steps: [],
      risk_level: 'medium',
      max_retries: 2,
      confidence_threshold: 0.7,
    },
    {
      chain_id: chain.id,
      step_order: 2,
      name: 'Read Config',
      description: 'Read the AutoResearch experiment configuration.',
      entity_id: autoResearchId,
      action: 'autoresearch_read_config',
      input_mapping: {
        experiment_name: '$.input.experiment_name',
        config_overrides: '$.input.config_overrides',
      },
      output_key: 'config',
      depends_on_steps: [], // Remapped to step 1 ID below
      risk_level: 'low',
      max_retries: 1,
    },
    {
      chain_id: chain.id,
      step_order: 3,
      name: 'Train Model',
      description: 'Run GPU training via uv run train.py (up to 10 min timeout).',
      entity_id: autoResearchId,
      action: 'autoresearch_train',
      input_mapping: {
        experiment_name: '$.input.experiment_name',
        config: '$.steps.config.output',
      },
      output_key: 'training',
      depends_on_steps: [], // Remapped to step 2 ID below
      risk_level: 'high', // Significant GPU compute usage
      max_retries: 1,
      confidence_threshold: 0.75,
    },
    {
      chain_id: chain.id,
      step_order: 4,
      name: 'Read Results',
      description: 'Read training metrics and experiment results.',
      entity_id: autoResearchId,
      action: 'autoresearch_read_results',
      input_mapping: {
        experiment_name: '$.input.experiment_name',
        training_output: '$.steps.training.output',
      },
      output_key: 'results',
      depends_on_steps: [], // Remapped to step 3 ID below
      risk_level: 'low',
      max_retries: 2,
    },
    {
      chain_id: chain.id,
      step_order: 5,
      name: 'Read Research Program',
      description: 'Read the generated research program / next-hypothesis suggestions.',
      entity_id: autoResearchId,
      action: 'autoresearch_read_program',
      input_mapping: {
        experiment_name: '$.input.experiment_name',
        results: '$.steps.results.output',
      },
      output_key: 'program',
      depends_on_steps: [], // Remapped to step 4 ID below
      risk_level: 'low',
      max_retries: 1,
    },
  ]);

  // Now that we have instance IDs, patch depends_on_steps
  // steps[0]=prepare, steps[1]=config, steps[2]=train, steps[3]=results, steps[4]=program
  const [prepareStep, configStep, trainStep, resultsStep, programStep] = steps;

  // We need to update the db rows with the real dependency IDs.
  // Use addSteps' underlying supabase client via the chains module helpers.
  // Since addSteps doesn't expose an update, we re-use the pattern from instantiateChain:
  // call the registry's supabase client directly.
  const { createDraymondClient } = await import('./client');
  const supabase = await createDraymondClient();

  const depPatches = [
    { id: configStep.id,  depends_on_steps: [prepareStep.id] },
    { id: trainStep.id,   depends_on_steps: [configStep.id]  },
    { id: resultsStep.id, depends_on_steps: [trainStep.id]   },
    { id: programStep.id, depends_on_steps: [resultsStep.id] },
  ];

  for (const patch of depPatches) {
    const { error } = await supabase
      .from('draymond_chain_steps')
      .update({ depends_on_steps: patch.depends_on_steps })
      .eq('id', patch.id);
    if (error) {
      console.error(`[Chains Seed] Failed to patch deps for step ${patch.id}: ${error.message}`);
    }
  }

  // Update total_steps
  await supabase
    .from('draymond_chains')
    .update({ total_steps: steps.length })
    .eq('id', chain.id);

  return { ...chain, total_steps: steps.length };
}

/**
 * Seed the CIS Contract Workflow chain template.
 *
 * Workflow:
 *   Step 1 — Onboard business    (cis_onboard_business)
 *   Step 2 — Generate contract   (cis_generate_contract)   [depends on step 1]
 *   Step 3 — Validate contract   (cis_validate_contract)   [depends on step 2]
 *   Step 4 — Compliance check    (cis_compliance_checklist)[depends on step 1, parallel with step 2-3]
 *
 * Steps 2 and 4 run in parallel after step 1 completes (different parallel_group).
 * Step 3 depends on step 2 (validate after generate).
 */
async function seedCisContractWorkflow(): Promise<DraymondChain> {
  const cisAssistantId = await requireEntityBySlug('mcp-cis-assistant');

  const chain = await createChain({
    name: 'CIS Contract Workflow',
    slug: 'tpl-cis-contract-workflow',
    description:
      'UK Construction Industry Scheme (CIS) contract generation and compliance workflow. Onboards a business, generates a compliant contract, validates it, and runs a compliance checklist in parallel.',
    version: '1.0.0',
    is_template: true,
    status: 'draft',
    trigger_type: 'manual',
    input_data: {
      // Defaults — override at instantiation time
      business_name: null,
      business_type: 'subcontractor', // 'contractor' | 'subcontractor'
      utr_number: null,           // Unique Taxpayer Reference
      contract_type: 'standard',  // 'standard' | 'bespoke'
      contract_value_gbp: null,
      deduction_rate: 20,         // 0 | 20 | 30 percent
    },
    context: {},
    max_retries: 2,
  });

  const steps = await addSteps([
    {
      chain_id: chain.id,
      step_order: 1,
      name: 'Onboard Business',
      description: 'Onboard the business or subcontractor into the CIS system.',
      entity_id: cisAssistantId,
      action: 'cis_onboard_business',
      input_mapping: {
        business_name: '$.input.business_name',
        business_type: '$.input.business_type',
        utr_number: '$.input.utr_number',
      },
      output_key: 'onboarding',
      depends_on_steps: [],
      risk_level: 'medium',
      max_retries: 2,
      confidence_threshold: 0.75,
    },
    {
      chain_id: chain.id,
      step_order: 2,
      name: 'Generate Contract',
      description: 'Generate a CIS-compliant contract for the onboarded business.',
      entity_id: cisAssistantId,
      action: 'cis_generate_contract',
      input_mapping: {
        business_name: '$.input.business_name',
        contract_type: '$.input.contract_type',
        contract_value_gbp: '$.input.contract_value_gbp',
        deduction_rate: '$.input.deduction_rate',
        onboarding_data: '$.steps.onboarding.output',
      },
      output_key: 'contract',
      depends_on_steps: [], // Remapped to step 1 below
      parallel_group: 'post-onboarding',
      risk_level: 'high', // Legal document generation — high stakes
      max_retries: 2,
      confidence_threshold: 0.8,
    },
    {
      chain_id: chain.id,
      step_order: 2,
      name: 'Compliance Checklist',
      description: 'Run CIS compliance checklist in parallel with contract generation.',
      entity_id: cisAssistantId,
      action: 'cis_compliance_checklist',
      input_mapping: {
        business_name: '$.input.business_name',
        business_type: '$.input.business_type',
        utr_number: '$.input.utr_number',
      },
      output_key: 'compliance',
      depends_on_steps: [], // Remapped to step 1 below
      parallel_group: 'post-onboarding',
      risk_level: 'low',
      max_retries: 2,
    },
    {
      chain_id: chain.id,
      step_order: 3,
      name: 'Validate Contract',
      description: 'Validate the generated contract against CIS regulations.',
      entity_id: cisAssistantId,
      action: 'cis_validate_contract',
      input_mapping: {
        contract: '$.steps.contract.output',
        deduction_rate: '$.input.deduction_rate',
      },
      output_key: 'validation',
      depends_on_steps: [], // Remapped to step 2 (generate) below
      risk_level: 'medium',
      max_retries: 2,
      confidence_threshold: 0.8,
    },
  ]);

  // steps[0]=onboard, steps[1]=generate, steps[2]=compliance, steps[3]=validate
  const [onboardStep, generateStep, , validateStep] = steps;

  const { createDraymondClient } = await import('./client');
  const supabase = await createDraymondClient();

  const depPatches = [
    { id: generateStep.id,  depends_on_steps: [onboardStep.id]  },
    { id: steps[2].id,      depends_on_steps: [onboardStep.id]  }, // compliance depends on onboard
    { id: validateStep.id,  depends_on_steps: [generateStep.id] },
  ];

  for (const patch of depPatches) {
    const { error } = await supabase
      .from('draymond_chain_steps')
      .update({ depends_on_steps: patch.depends_on_steps })
      .eq('id', patch.id);
    if (error) {
      console.error(`[Chains Seed] Failed to patch deps for step ${patch.id}: ${error.message}`);
    }
  }

  await supabase
    .from('draymond_chains')
    .update({ total_steps: steps.length })
    .eq('id', chain.id);

  return { ...chain, total_steps: steps.length };
}

/**
 * Seed the Book-to-Skill Chain template.
 *
 * Workflow:
 *   Step 1 — Ground with BookBridge (bookbridge: search + reading_plan)
 *   Step 2 — Synthesize             (book-synthesis-personal)     [depends on step 1]
 *   Step 3 — Convert to skill       (book-to-skill)               [depends on step 2]
 *   Step 4 — Register skill         (book-to-skill-chain)         [depends on step 3]
 *
 * Turns a book (or a library topic) into an installable agent skill that
 * Draymond agents can discover and use.
 */
async function seedBookToSkillChain(): Promise<DraymondChain> {
  const bookbridgeId = await requireEntityBySlug('bookbridge');
  const synthesisId = await requireEntityBySlug('book-synthesis-personal');
  const converterId = await requireEntityBySlug('book-to-skill');

  const chain = await createChain({
    name: 'Book-to-Skill Chain',
    slug: 'tpl-book-to-skill-chain',
    description:
      'Ground a book with BookBridge, synthesize its frameworks, convert it into a reusable agent skill, and register it for Draymond agents. Modes: single book (source path or book_id) or whole library.',
    version: '1.0.0',
    is_template: true,
    status: 'draft',
    trigger_type: 'manual',
    input_data: {
      // Defaults — override at instantiation time
      source: null,         // path to a book file, a BookBridge book_id, or a directory/glob
      skill_name: null,     // slug for the generated skill
      book_type: 'text',    // 'technical' | 'text'
      mode: 'single',       // 'single' | 'library'
      topic: null,          // research topic used for BookBridge grounding + reading plan
    },
    context: {},
    max_retries: 2,
  });

  const steps = await addSteps([
    {
      chain_id: chain.id,
      step_order: 1,
      name: 'Ground with BookBridge',
      description: 'Search the library and generate a reading plan for the topic; add/scan the source so it is searchable.',
      entity_id: bookbridgeId,
      action: 'bookbridge_ground',
      input_mapping: {
        topic: '$.input.topic',
        source: '$.input.source',
      },
      output_key: 'grounding',
      depends_on_steps: [],
      risk_level: 'low',
      max_retries: 2,
      confidence_threshold: 0.6,
    },
    {
      chain_id: chain.id,
      step_order: 2,
      name: 'Synthesize',
      description: 'Produce a synthesis brief of the author\'s frameworks, principles, techniques, and anti-patterns.',
      entity_id: synthesisId,
      action: 'book_synthesize',
      input_mapping: {
        source: '$.input.source',
        topic: '$.input.topic',
        grounding: '$.steps.grounding.output',
      },
      output_key: 'synthesis',
      depends_on_steps: [], // Remapped to step 1 below
      risk_level: 'low',
      max_retries: 2,
      confidence_threshold: 0.7,
    },
    {
      chain_id: chain.id,
      step_order: 3,
      name: 'Convert to Skill',
      description: 'Run the book-to-skill converter to generate SKILL.md, chapters, glossary, patterns, cheatsheet.',
      entity_id: converterId,
      action: 'book_to_skill_convert',
      input_mapping: {
        source: '$.input.source',
        skill_name: '$.input.skill_name',
        book_type: '$.input.book_type',
        synthesis: '$.steps.synthesis.output',
      },
      output_key: 'generated_skill',
      depends_on_steps: [], // Remapped to step 2 below
      risk_level: 'medium',
      max_retries: 2,
      confidence_threshold: 0.75,
    },
  ]);

  // steps[0]=ground, steps[1]=synthesize, steps[2]=convert
  const [groundStep, synthesizeStep, convertStep] = steps;

  const { createDraymondClient } = await import('./client');
  const supabase = await createDraymondClient();

  const depPatches = [
    { id: synthesizeStep.id, depends_on_steps: [groundStep.id] },
    { id: convertStep.id,    depends_on_steps: [synthesizeStep.id] },
  ];

  for (const patch of depPatches) {
    const { error } = await supabase
      .from('draymond_chain_steps')
      .update({ depends_on_steps: patch.depends_on_steps })
      .eq('id', patch.id);
    if (error) {
      console.error(`[Chains Seed] Failed to patch deps for step ${patch.id}: ${error.message}`);
    }
  }

  await supabase
    .from('draymond_chains')
    .update({ total_steps: steps.length })
    .eq('id', chain.id);

  return { ...chain, total_steps: steps.length };
}

// ============================================================================
// SEED RUNNER
// ============================================================================

export interface ChainSeedResult {
  seeded: Array<{ name: string; slug: string; id: string }>;
  errors: Array<{ name: string; error: string }>;
}

/**
 * Seed all chain templates.
 * Skips templates whose slug already exists in the database.
 */
export async function seedChainTemplates(): Promise<ChainSeedResult> {
  const { getChain } = await import('./chains');

  const seeded: ChainSeedResult['seeded'] = [];
  const errors: ChainSeedResult['errors'] = [];

  const templates: Array<{ name: string; slug: string; fn: () => Promise<DraymondChain> }> = [
    {
      name: 'ML Research Loop',
      slug: 'tpl-ml-research-loop',
      fn: seedMlResearchLoop,
    },
    {
      name: 'CIS Contract Workflow',
      slug: 'tpl-cis-contract-workflow',
      fn: seedCisContractWorkflow,
    },
    {
      name: 'Book-to-Skill Chain',
      slug: 'tpl-book-to-skill-chain',
      fn: seedBookToSkillChain,
    },
  ];

  for (const tpl of templates) {
    try {
      // Check if already exists (idempotent)
      const existing = await getChain(tpl.slug);
      if (existing) {
        seeded.push({ name: tpl.name, slug: tpl.slug, id: existing.id });
        continue;
      }

      const chain = await tpl.fn();
      seeded.push({ name: tpl.name, slug: tpl.slug, id: chain.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Chains Seed] Failed to seed "${tpl.name}": ${message}`);
      errors.push({ name: tpl.name, error: message });
    }
  }

  return { seeded, errors };
}
