import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { verifyBackupsJob } from '@/lib/draymond/security-jobs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/backup-status — read-only fleet-backup integrity.
 * 200 when the newest snapshot is healthy, 503 otherwise. Never emits alerts
 * (safe to poll from monitors/panels); the `Backup Verify` job owns alerting.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const status = await verifyBackupsJob(false);
  return NextResponse.json(status, { status: status.ok ? 200 : 503 });
}
