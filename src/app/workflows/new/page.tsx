/**
 * /workflows/new — Server wrapper for the workflow creation form.
 *
 * Fetches active entities server-side (so CRON_SECRET stays on the server)
 * and passes a simplified list to the client-side form component.
 */
import { searchEntities } from '@/lib/draymond/registry';
import WorkflowForm from './WorkflowForm';
import type { EntityKind } from '@/lib/draymond/types';

export const dynamic = 'force-dynamic';

export default async function NewWorkflowPage() {
  let entityOptions: { id: string; name: string; slug: string; kind: EntityKind; capabilities: string[] }[] = [];

  try {
    const entities = await searchEntities({ is_active: true });
    entityOptions = entities.map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      kind: e.kind,
      capabilities: e.capabilities,
    }));
  } catch (err) {
    console.error('[NewWorkflowPage] Failed to load entities:', err);
    // Continue with empty list — form will still work, just no entity dropdown
  }

  return (
    <div className="min-h-screen text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-black tracking-tight">New Workflow</h1>
          <p className="text-white/40 text-sm mt-1">
            Create a reusable workflow template
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        <WorkflowForm entities={entityOptions} />
      </div>
    </div>
  );
}
