// ============================================================================
// DRAYMOND MASTER CODING STACK — the definitive coding toolset
// ============================================================================
// The canonical, deduplicated coding toolchain for the ecosystem. Every coding
// task routes through exactly one tool per layer (with a fallback), so the
// repair team, chains, and schedulers never guess which agent to call.
//
// Deduplication notes:
//   codegen   uplift-agent (Hermes fork, 52 tools/244 skills) is primary;
//             megacode (JetBrains multi-LLM) is the refactor fallback;
//             everything-claude-code owns agent/CLI/skill authoring;
//             sub-team owns deterministic spec→impl→verify pipelines.
//   review    reporank (repo-level scoring + remediation) primary, grader
//             (data-backed grade) fallback, big-homie the quality gate.
//   security  claw-protect (secrets/prompt-injection) + depscan (SCA) +
//             nuclei-scanner (external surface) — three narrow tools instead
//             of four overlapping scanners.
//   ide       mutly is the single developer daemon (index/search/sandbox tests).
// ============================================================================

export interface CodingLayer {
  id: string;
  label: string;
  /** Canonical slug for this layer. */
  primary: string;
  /** Slug tried when the primary is unavailable/fails. */
  fallback?: string;
  /** Every tool that can serve this layer, ordered primary→fallback→others. */
  tools: string[];
  description: string;
}

/** The definitive coding stack — one canonical tool per layer. */
export const CODING_STACK: CodingLayer[] = [
  {
    id: 'codegen',
    label: 'Code Generation & Editing',
    primary: 'opencode',
    fallback: 'uplift-agent',
    tools: ['opencode', 'uplift-agent', 'megacode', 'everything-claude-code', 'sub-team'],
    description: 'Write and edit code. opencode (deepseek-v4-flash 0731, headless serve) is the primary codegen engine; Uplift Agent (Hermes fork) is the fallback; Megacode handles multi-LLM/JetBrains work; Everything Claude Code owns agent/CLI/skill authoring; Sub-Team runs deterministic spec-to-implementation pipelines.',
  },
  {
    id: 'refactor',
    label: 'Refactoring & Large Edits',
    primary: 'megacode',
    fallback: 'opencode',
    tools: ['megacode', 'opencode', 'uplift-agent'],
    description: 'Mass/mechanical edits, cross-file refactors, and IDE-driven changes.',
  },
  {
    id: 'review',
    label: 'Code & Repo Review',
    primary: 'reporank',
    fallback: 'grader',
    tools: ['reporank', 'grader', 'big-homie', 'codegang'],
    description: 'Score and audit a repo: RepoRank for depth + remediation plans, Grader for the data-backed grade, Big Homie for the merge quality gate, Codegang for local deep analysis of on-disk workspaces (no GitHub URL needed).',
  },
  {
    id: 'security',
    label: 'Security Scanning',
    primary: 'claw-protect',
    tools: ['claw-protect', 'depscan', 'nuclei-scanner'],
    description: 'Three narrow scanners: Claw-Protect (secrets/prompt-injection), dep-scan (dependency CVEs), Nuclei (external vuln surface).',
  },
  {
    id: 'ide',
    label: 'Developer Daemon & IDE',
    primary: 'mutly',
    tools: ['mutly'],
    description: 'Codebase indexing, semantic search, sandboxed tests, and IDE integration.',
  },
  {
    id: 'tooling',
    label: 'Tool Orchestration & Browser',
    primary: 'composio',
    fallback: 'agent-browser',
    tools: ['composio', 'agent-browser'],
    description: 'Connect external tools/APIs (Composio) and drive the browser (AgentBrowser).',
  },
  {
    id: 'verify',
    label: 'Deterministic Verification',
    primary: 'sub-team',
    fallback: 'mutly',
    tools: ['sub-team', 'mutly'],
    description: 'Deterministic build→verify pipelines and sandboxed test execution.',
  },
];

export type CodingLayerId = CodingLayer['id'];

/** Look up a layer by id. */
export function getCodingLayer(id: string): CodingLayer | undefined {
  return CODING_STACK.find((l) => l.id === id);
}

/** Resolve the tool slugs to dispatch for a layer, primary first. */
export function resolveCodingTools(id: string, available?: string[]): string[] {
  const layer = getCodingLayer(id);
  if (!layer) return [];
  const ordered: string[] = [
    layer.primary,
    ...(layer.fallback ? [layer.fallback] : []),
    ...layer.tools,
  ].filter((t, i, arr) => arr.indexOf(t) === i);
  if (!available || available.length === 0) return ordered;
  const avail = new Set(available);
  return ordered.filter((t) => avail.has(t));
}

/** Concise summary used in repair reports and chain context. */
export function codingStackSummary(): string {
  return CODING_STACK.map(
    (l) => `${l.label}: ${[l.primary, l.fallback].filter(Boolean).join(' → ')}`
  ).join(' | ');
}
