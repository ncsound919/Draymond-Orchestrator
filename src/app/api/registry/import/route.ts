/**
 * POST /api/registry/import
 *
 * Accepts a parsed FileMap from the browser's FolderImportWizard
 * and registers the agent + workflows into the store.
 *
 * Body: { folderName: string; files: Record<string, string> }
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseAgentPack } from '@/lib/registry/parse-agent-pack';
import { upsertAgent, upsertWorkflow } from '@/lib/registry/agent-store';
import { appendAuditLog } from '@/lib/audit';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const bodyResult = await parseJsonBody<{ folderName: string; files: Record<string, string> }>(request);
    if (bodyResult.error) return bodyResult.error;
    const { folderName, files } = bodyResult.data;

    if (!folderName || typeof folderName !== 'string') {
      return NextResponse.json({ error: 'folderName is required' }, { status: 400 });
    }
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      return NextResponse.json({ error: 'files map is required' }, { status: 400 });
    }
    if (Object.keys(files).length === 0) {
      return NextResponse.json({ error: 'Folder appears empty' }, { status: 400 });
    }

    const { agent, workflows } = parseAgentPack(files, folderName);

    await upsertAgent(agent);
    for (const wf of workflows) await upsertWorkflow(wf);

    await appendAuditLog({
      event: 'agent_imported',
      agent: agent.slug,
      source: 'folder_upload',
      workflow_count: workflows.length,
    });

    return NextResponse.json({
      ok: true,
      agent: { id: agent.id, slug: agent.slug, name: agent.name },
      workflowsImported: workflows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 },
    );
  }
}
