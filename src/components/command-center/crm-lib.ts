// ============================================================================
// CRM — pure helpers (unit-tested, no network)
// ============================================================================
import { LEAD_STAGES, type CommandLead, type LeadStage } from '@/lib/command-center/types';

/** Format a value stored in cents as a whole-dollar currency string. */
export function formatCents(cents: number | null | undefined): string {
  const n = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0;
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.abs(n) / 100);
  return n < 0 ? `-${formatted}` : formatted;
}

/** Total value (in cents) of all leads not in the won/lost terminal stages. */
export function pipelineValue(leads: CommandLead[] | null | undefined): number {
  return (leads ?? []).reduce((sum, lead) => {
    if (lead.stage === 'won' || lead.stage === 'lost') return sum;
    const v = lead.value_cents;
    return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  }, 0);
}

/** Count leads currently sitting in a given stage. */
export function leadStageCount(
  leads: CommandLead[] | null | undefined,
  stage: LeadStage,
): number {
  return (leads ?? []).filter((lead) => lead.stage === stage).length;
}

/**
 * Next pipeline stage in the funnel, or null when the lead is in a terminal
 * stage (won/lost) or the stage is unknown.
 */
export function nextStage(stage: LeadStage | string | null | undefined): LeadStage | null {
  if (!stage || stage === 'won' || stage === 'lost') return null;
  const idx = LEAD_STAGES.indexOf(stage as LeadStage);
  if (idx === -1 || idx === LEAD_STAGES.length - 1) return null;
  return LEAD_STAGES[idx + 1];
}
