// src/components/visualizer/state/eventMappings.ts
import type { SimAction } from './reducer';

export interface SseEnvelope {
  type: string;
  data: Record<string, unknown>;
  ts: string;
}

/** Map a job name like "litellm_rotation" to a building slug "litellm". */
export function slugFromJobName(name: string): string {
  return name.split('_')[0].toLowerCase() || 'draymond';
}

export function mapSseEnvelope(env: SseEnvelope): SimAction[] {
  const { type, data } = env;
  const jobId = String(data.job_id ?? '');
  const jobName = String(data.job_name ?? '');
  const jobType = String(data.job_type ?? '');
  const to = String(data.to ?? '') || slugFromJobName(jobName);

  switch (type) {
    case 'scheduler.job_started':
      return [{ type: 'JOB_STARTED', jobId, jobName, jobType, to }];
    case 'scheduler.job_completed':
      return [{ type: 'JOB_COMPLETED', jobId, jobName, jobType, to }];
    case 'scheduler.job_failed':
      return [{ type: 'JOB_FAILED', jobId, jobName, jobType, to }];
    default:
      return [];
  }
}