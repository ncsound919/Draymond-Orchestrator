export type EvidenceTier = 'E1' | 'E2' | 'E3' | 'E4';

// Known engines; unknowns fall through to the widened string so they stay valid
// (dag.ts maps unrecognized engines to the E3 evidence tier).
export type EngineName = 'stat_crew' | 'coach' | 'math_core' | 'sim-kernel' | 'translation' | 'insights' | 'formula' | 'layers' | (string & {});

// Note: TaskStatus.'done' contributes to an experiment-level status of
// 'completed' (see ExperimentStatus). dag.ts `statusOf` performs the mapping.
export type TaskStatus = 'pending' | 'running' | 'awaiting_human' | 'done' | 'failed';

export interface TaskEvidence {
  tier: EvidenceTier;
  payloadHash?: string;
  lineageParentIds: string[];
  qualityScore?: number;
}

export interface Task {
  id: string;
  engine: EngineName;
  inputs: Record<string, unknown>;
  depends_on: string[];
  is_gate: boolean;
  status: TaskStatus;
  evidence: TaskEvidence;
  result?: unknown;
  error?: string;
}

export interface TaskDAG {
  experiment_id: string;
  goal: string;
  tasks: Task[];
  created_at: string;
}

export interface ExperimentStatus {
  experiment_id: string;
  status: 'pending' | 'running' | 'awaiting_human' | 'completed' | 'failed' | 'cancelled';
  tasks: Task[];
  goal?: string;
  created_at: string;
  updated_at: string;
}
