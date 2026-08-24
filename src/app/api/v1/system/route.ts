import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import {
  systemAgentHealth,
  systemInfo,
  systemProcesses,
  systemConnections,
  systemUsb,
  systemDefender,
  systemServices,
  systemTasks,
  systemSnapshot,
  systemRecentAudit,
  systemAgentStatus,
  controlLaunch,
  controlKill,
  controlPower,
  controlFile,
  controlService,
  controlPriority,
  mintSystemApproval,
} from '@/lib/draymond/system-agent';

export const dynamic = 'force-dynamic';

/** GET /api/v1/system/* — laptop-wide telemetry + health (read-only). */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind') ?? 'health';

  switch (kind) {
    case 'info':
      return NextResponse.json(await systemInfo());
    case 'processes':
      return NextResponse.json(await systemProcesses());
    case 'connections':
      return NextResponse.json(await systemConnections());
    case 'usb':
      return NextResponse.json(await systemUsb());
    case 'defender':
      return NextResponse.json(await systemDefender());
    case 'services':
      return NextResponse.json(await systemServices());
    case 'tasks':
      return NextResponse.json(await systemTasks());
    case 'snapshot':
      return NextResponse.json(await systemSnapshot());
    case 'audit':
      return NextResponse.json(await systemRecentAudit());
    case 'agent':
      return NextResponse.json(await systemAgentStatus());
    case 'health':
    default:
      return NextResponse.json(await systemAgentHealth());
  }
}

/** POST /api/v1/system/* — control actions (launch/kill/power/file/service). */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind');

  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  if (!kind) {
    return NextResponse.json({ error: 'kind is required' }, { status: 400 });
  }

  // Dangerous control actions need an approval token minted via the
  // /api/v1/system/approve route (which runs the human ntfy approval gate).
  switch (kind) {
    case 'launch': {
      const path = body.path as string | undefined;
      if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });
      const token = mintSystemApproval('launch', path);
      if (!token) return NextResponse.json({ error: 'approval secret not configured' }, { status: 500 });
      const result = await controlLaunch({ path, args: body.args as string[] | undefined, cwd: body.cwd as string | undefined, hidden: body.hidden as boolean | undefined }, token);
      return NextResponse.json(result, { status: result.status === 0 ? 502 : result.status });
    }
    case 'kill': {
      const pid = body.pid as number | undefined;
      const name = body.name as string | undefined;
      if (!pid && !name) return NextResponse.json({ error: 'pid or name required' }, { status: 400 });
      const target = pid ? String(pid) : String(name);
      const token = mintSystemApproval('kill', target);
      if (!token) return NextResponse.json({ error: 'approval secret not configured' }, { status: 500 });
      const result = await controlKill({ pid, name, force: body.force as boolean | undefined }, token);
      return NextResponse.json(result, { status: result.status === 0 ? 502 : result.status });
    }
    case 'power': {
      const action = body.action as string | undefined;
      if (!action || !['shutdown', 'restart', 'sleep', 'hibernate', 'lock'].includes(action)) {
        return NextResponse.json({ error: 'action must be shutdown|restart|sleep|hibernate|lock' }, { status: 400 });
      }
      const token = mintSystemApproval('power', action);
      if (!token) return NextResponse.json({ error: 'approval secret not configured' }, { status: 500 });
      const result = await controlPower(
        { action: action as 'shutdown' | 'restart' | 'sleep' | 'hibernate' | 'lock' },
        token,
      );
      return NextResponse.json(result, { status: result.status === 0 ? 502 : result.status });
    }
    case 'file': {
      const op = body.op as string | undefined;
      const target = body.path as string | undefined;
      if (!op || !target) return NextResponse.json({ error: 'op and path required' }, { status: 400 });
      const token = mintSystemApproval('file', target);
      if (!token) return NextResponse.json({ error: 'approval secret not configured' }, { status: 500 });
      const result = await controlFile({ op, path: target, dest: body.dest as string | undefined }, token);
      return NextResponse.json(result, { status: result.status === 0 ? 502 : result.status });
    }
    case 'service': {
      const name = body.name as string | undefined;
      const action = body.action as string | undefined;
      if (!name || !action || !['start', 'stop', 'restart'].includes(action)) {
        return NextResponse.json({ error: 'name and action (start|stop|restart) required' }, { status: 400 });
      }
      const token = mintSystemApproval('service', name);
      if (!token) return NextResponse.json({ error: 'approval secret not configured' }, { status: 500 });
      const result = await controlService(
        { name, action: action as 'start' | 'stop' | 'restart' },
        token,
      );
      return NextResponse.json(result, { status: result.status === 0 ? 502 : result.status });
    }
    case 'priority': {
      const pid = body.pid as number | undefined;
      const priority = body.priority as string | undefined;
      if (!pid || !priority) return NextResponse.json({ error: 'pid and priority required' }, { status: 400 });
      const token = mintSystemApproval('priority', String(pid));
      if (!token) return NextResponse.json({ error: 'approval secret not configured' }, { status: 500 });
      const result = await controlPriority({ pid, priority }, token);
      return NextResponse.json(result, { status: result.status === 0 ? 502 : result.status });
    }
    default:
      return NextResponse.json({ error: `unknown kind: ${kind}` }, { status: 400 });
  }
}
