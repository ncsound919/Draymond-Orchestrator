// ============================================================================
// Command Center — shared types
// ============================================================================

export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export interface CommandLead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  stage: LeadStage;
  value_cents: number;
  owner: string | null;
  source: string | null;
  notes: Array<{ text: string; at: string; by?: string }>;
  tags: string[];
  metadata: Record<string, unknown>;
  next_follow_up_at: string | null;
  created_at: string;
  updated_at: string;
}

export type LeadInsert = Partial<Omit<CommandLead, 'id' | 'created_at' | 'updated_at'>> &
  Pick<CommandLead, 'name'>;

export const SEO_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type SeoPriority = (typeof SEO_PRIORITIES)[number];

export const SEO_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;
export type SeoStatus = (typeof SEO_STATUSES)[number];

export interface SeoTask {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  priority: SeoPriority;
  status: SeoStatus;
  owner: string | null;
  is_done: boolean;
  metadata: Record<string, unknown>;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SeoTaskInsert = Partial<Omit<SeoTask, 'id' | 'created_at' | 'updated_at'>> &
  Pick<SeoTask, 'title'>;

// ── Deploy ──────────────────────────────────────────────────────────────────

export interface DeployTarget {
  id: string;
  name: string;
  kind: 'local' | 'remote';
  /** Process/script to restart for `local` targets. */
  process?: string;
  /** URL to smoke-test after deploy. */
  url?: string;
  expectedStatus?: number;
}

export interface DeployResult {
  ok: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
  durationMs: number;
}
