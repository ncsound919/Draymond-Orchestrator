import { NextResponse } from 'next/server';
import { pingUplift } from '@/lib/uplift';

export async function GET() {
  const alive = await pingUplift();
  return NextResponse.json({
    uplift_online: alive,
    uplift_url: process.env.UPLIFT_BASE_URL || 'http://localhost:8000',
    checked_at: new Date().toISOString(),
  }, { status: alive ? 200 : 503 });
}
