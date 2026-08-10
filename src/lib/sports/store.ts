import { createDraymondClient } from '@/lib/draymond/client';
import type { ExperimentStatus } from './types';

const TABLE = 'sports_experiments';

export async function saveExperiment(exp: ExperimentStatus): Promise<void> {
  const supabase = await createDraymondClient();
  const row = {
    experiment_id: exp.experiment_id,
    status: exp.status,
    goal: exp.goal ?? '',
    created_at: exp.created_at,
    updated_at: exp.updated_at,
    dag: exp,
  };
  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'experiment_id' });
  if (error) throw new Error(`Failed to save experiment: ${error.message}`);
}

export async function getExperiment(id: string): Promise<ExperimentStatus | null> {
  const supabase = await createDraymondClient();
  const { data, error } = await supabase.from(TABLE).select().eq('experiment_id', id).single();
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch experiment: ${error.message}`);
  }
  if (!data) return null;
  return (data as { dag: ExperimentStatus }).dag;
}

export async function getExperimentsMap(): Promise<Record<string, ExperimentStatus>> {
  const supabase = await createDraymondClient();
  const { data, error } = await supabase.from(TABLE).select();
  if (error) throw new Error(`Failed to list experiments: ${error.message}`);
  const map: Record<string, ExperimentStatus> = {};
  for (const row of (data ?? []) as Array<{ dag: unknown }>) {
    try {
      const exp =
        typeof row.dag === 'string' ? (JSON.parse(row.dag) as ExperimentStatus) : (row.dag as ExperimentStatus);
      if (!exp || typeof exp.experiment_id !== 'string') continue;
      map[exp.experiment_id] = exp;
    } catch {
      // skip malformed/legacy rows rather than failing the whole list
    }
  }
  return map;
}
