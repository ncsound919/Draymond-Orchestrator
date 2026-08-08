// ---------------------------------------------------------------------------
// Core shared types for the embedded Math X core.
// Ported from @mathx/math-core/src/types.ts (see docs/mathx-source-reference).
// Pure TS, zero dependencies — safe in Node and browser runtimes.
// ---------------------------------------------------------------------------

/** Model provider identifiers (Math X native set). */
export type ModelProvider = 'claude' | 'ollama' | 'qwen';

/** All supported mode identifiers. */
export type MathXMode =
  | 'scientist'
  | 'formula'
  | 'hypothesis'
  | 'deep-solve'
  | 'synergy'
  | 'probability'
  | 'file-intel';

/** All registered domain identifiers for Domain Expert mode. */
export type MathXDomain =
  | 'algebraic_number_theory'
  | 'algebraic_topology'
  | 'differential_geometry'
  | 'pde'
  | 'functional_analysis'
  | 'quantum_math'
  | 'combinatorics_graph'
  | 'complexity_theory'
  | 'cryptographic_math'
  | 'mathematical_physics'
  | 'financial_math'
  | 'machine_learning_math'
  | 'control_theory'
  | 'information_theory'
  | 'climate_math'
  | 'biomathematics';

/** Supported export format keys. */
export type ExportFormat = 'markdown' | 'latex' | 'jupyter' | 'plain';

// ---------------------------------------------------------------------------
// Message & conversation types
// ---------------------------------------------------------------------------

export interface ContentPart {
  type: string;
  text?: string;
  source?: unknown;
}

/** A single turn in a conversation. */
export interface MathXMessage {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

export interface UsageStats {
  input_tokens: number;
  output_tokens: number;
}

// ---------------------------------------------------------------------------
// Planning & execution
// ---------------------------------------------------------------------------

/** Computation engine identifiers used by the plan route. */
export type EngineType =
  | 'symbolic'
  | 'montecarlo'
  | 'bayesian'
  | 'dataset'
  | 'plot'
  | 'compute'
  | 'document'
  | 'reason';

export interface ExecutionPlan {
  engine: EngineType | string;
  requires_code: boolean;
  requires_chart: boolean;
  requires_retrieval: boolean;
  domain: string;
  complexity: 'low' | 'medium' | 'high';
  summary: string;
  chain: string[];
}

// ---------------------------------------------------------------------------
// RAG / retrieval
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  source: string;
  text: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerificationStatus =
  | 'pending'
  | 'verifying'
  | 'VERIFIED'
  | 'UNVERIFIED'
  | 'ERROR'
  | 'skipped';

export interface VerificationResult {
  id: string;
  status: VerificationStatus;
  error?: string;
  sympy_code?: string;
}

// ---------------------------------------------------------------------------
// Chart / visualization output from Pyodide
// ---------------------------------------------------------------------------

export interface PlotlyTrace {
  x?: number[] | string[];
  y?: number[] | string[];
  z?: number[][];
  type?: string;
  mode?: string;
  name?: string;
  line?: Record<string, unknown>;
  marker?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlotlySpec {
  data: PlotlyTrace[];
  layout?: Record<string, unknown>;
  type?: string;
}

export interface TableData {
  columns: string[];
  rows: unknown[][];
}

export interface PyodideOutput {
  stdout?: string;
  chart?: PlotlySpec;
  table?: TableData;
  error?: string;
}
