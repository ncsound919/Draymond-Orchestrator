/**
 * GET  /api/registry/systems  — list all registered systems (MCP, CLI, ACP, etc.)
 * POST /api/registry/systems  — register a system
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAllSystems, upsertSystem } from '@/lib/registry/agent-store';
import { RegisteredSystem } from '@/lib/registry/types';

export async function GET() {
  const systems = await getAllSystems();
  return NextResponse.json({ systems, total: systems.length });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<RegisteredSystem>;
    if (!body.id || !body.name || !body.type) {
      return NextResponse.json({ error: 'id, name, and type are required' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const system: RegisteredSystem = {
      description: '',
      config: { type: body.type! },
      tags: [],
      status: 'unknown',
      installedAt: now,
      sourceType: 'config',
      version: '1.0.0',
      ...body,
    } as RegisteredSystem;
    await upsertSystem(system);
    return NextResponse.json({ ok: true, system });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to register system' },
      { status: 500 },
    );
  }
}
