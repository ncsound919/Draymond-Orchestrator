'use client';

import { useState, useTransition } from 'react';
import { createWorkflow } from './actions';
import type { EntityKind } from '@/lib/draymond/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityOption = {
  id: string;
  name: string;
  slug: string;
  kind: EntityKind;
  capabilities: string[];
};

type StepDraft = {
  key: string; // client-only key for React list rendering
  name: string;
  entity_id: string;
  action: string;
  risk_level: string;
};

const TRIGGER_OPTIONS = ['manual', 'scheduled', 'api', 'webhook'] as const;
const RISK_OPTIONS = ['safe', 'low', 'medium', 'high', 'critical'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

let _stepKey = 0;
function nextKey(): string {
  _stepKey += 1;
  return `step-${_stepKey}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WorkflowForm({ entities }: { entities: EntityOption[] }) {
  // -- Basics
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<string>('manual');

  // -- Steps
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [showAddStep, setShowAddStep] = useState(false);

  // -- Inline add-step form state
  const [newStepName, setNewStepName] = useState('');
  const [newStepEntity, setNewStepEntity] = useState('');
  const [newStepAction, setNewStepAction] = useState('');
  const [newStepRisk, setNewStepRisk] = useState('low');

  // -- Submission
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // -- Handlers
  function handleNameChange(value: string) {
    setName(value);
    if (!slugManual) setSlug(slugify(value));
  }

  function addStep() {
    if (!newStepName.trim() || !newStepEntity || !newStepAction.trim()) return;
    setSteps((prev) => [
      ...prev,
      {
        key: nextKey(),
        name: newStepName.trim(),
        entity_id: newStepEntity,
        action: newStepAction.trim(),
        risk_level: newStepRisk,
      },
    ]);
    setNewStepName('');
    setNewStepEntity('');
    setNewStepAction('');
    setNewStepRisk('low');
    setShowAddStep(false);
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  function handleSubmit() {
    if (!name.trim() || !slug.trim()) {
      setError('Name and slug are required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createWorkflow({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim(),
          trigger_type: triggerType,
          steps: steps.map((s, i) => ({
            name: s.name,
            entity_id: s.entity_id,
            action: s.action,
            step_order: i + 1,
            risk_level: s.risk_level,
          })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create workflow');
      }
    });
  }

  // -- Shared input styles
  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/60';
  const selectCls =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/60';
  const labelCls = 'block text-xs font-bold tracking-widest uppercase text-white/40 mb-1.5';

  return (
    <div className="space-y-8">
      {/* ================================================================= */}
      {/* BASICS */}
      {/* ================================================================= */}
      <section className="rounded-xl bg-white/5 border border-white/10 p-5">
        <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
          Basics
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Name */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Nightly Content Pipeline"
              className={inputCls}
            />
          </div>

          {/* Slug */}
          <div>
            <label className={labelCls}>Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlugManual(true);
                setSlug(e.target.value);
              }}
              placeholder="auto-generated-from-name"
              className={inputCls}
            />
          </div>

          {/* Trigger Type */}
          <div>
            <label className={labelCls}>Trigger Type</label>
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              className={selectCls}
            >
              {TRIGGER_OPTIONS.map((t) => (
                <option key={t} value={t} className="bg-[#0a0a0f]">
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does this workflow do?"
              className={inputCls + ' resize-none'}
            />
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* STEPS */}
      {/* ================================================================= */}
      <section className="rounded-xl bg-white/5 border border-white/10 p-5">
        <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
          Steps
        </h2>

        {steps.length === 0 && !showAddStep && (
          <p className="text-white/30 text-sm mb-4">
            No steps added yet. A workflow needs at least one step.
          </p>
        )}

        {/* Step list */}
        {steps.length > 0 && (
          <div className="space-y-2 mb-4">
            {steps.map((step, idx) => {
              const entity = entities.find((e) => e.id === step.entity_id);
              return (
                <div
                  key={step.key}
                  className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/5 px-4 py-3"
                >
                  {/* Order badge */}
                  <span className="shrink-0 w-6 h-6 rounded-full bg-white/10 text-white/60 text-xs font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{step.name}</p>
                    <p className="text-xs text-white/40 truncate">
                      {entity ? `${entity.name} (${entity.kind})` : step.entity_id} &middot;{' '}
                      {step.action}
                    </p>
                  </div>

                  {/* Risk badge */}
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      step.risk_level === 'critical'
                        ? 'bg-red-500/20 text-red-400'
                        : step.risk_level === 'high'
                        ? 'bg-orange-500/20 text-orange-400'
                        : step.risk_level === 'medium'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : step.risk_level === 'low'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {step.risk_level}
                  </span>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => removeStep(step.key)}
                    className="shrink-0 rounded-md p-1 text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    aria-label={`Remove step ${step.name}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline add-step form */}
        {showAddStep && (
          <div className="rounded-lg bg-white/[0.03] border border-white/10 p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Step Name */}
              <div>
                <label className={labelCls}>Step Name</label>
                <input
                  type="text"
                  value={newStepName}
                  onChange={(e) => setNewStepName(e.target.value)}
                  placeholder="e.g. Generate Script"
                  className={inputCls}
                />
              </div>

              {/* Entity */}
              <div>
                <label className={labelCls}>Entity</label>
                <select
                  value={newStepEntity}
                  onChange={(e) => setNewStepEntity(e.target.value)}
                  className={selectCls}
                >
                  <option value="" className="bg-[#0a0a0f]">
                    Select entity...
                  </option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id} className="bg-[#0a0a0f]">
                      {e.name} ({e.kind})
                    </option>
                  ))}
                </select>
              </div>

              {/* Action */}
              <div>
                <label className={labelCls}>Action</label>
                <input
                  type="text"
                  value={newStepAction}
                  onChange={(e) => setNewStepAction(e.target.value)}
                  placeholder="e.g. generate, analyze, publish"
                  className={inputCls}
                />
              </div>

              {/* Risk Level */}
              <div>
                <label className={labelCls}>Risk Level</label>
                <select
                  value={newStepRisk}
                  onChange={(e) => setNewStepRisk(e.target.value)}
                  className={selectCls}
                >
                  {RISK_OPTIONS.map((r) => (
                    <option key={r} value={r} className="bg-[#0a0a0f]">
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Add / Cancel */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={addStep}
                disabled={!newStepName.trim() || !newStepEntity || !newStepAction.trim()}
                className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-[#22c55e] hover:bg-[#16a34a] text-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add Step
              </button>
              <button
                type="button"
                onClick={() => setShowAddStep(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* "+ Add Step" button */}
        {!showAddStep && (
          <button
            type="button"
            onClick={() => setShowAddStep(true)}
            aria-expanded={showAddStep}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white"
          >
            + Add Step
          </button>
        )}
      </section>

      {/* ================================================================= */}
      {/* SUBMIT */}
      {/* ================================================================= */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || !name.trim() || !slug.trim()}
          className="rounded-lg px-6 py-2.5 text-sm font-semibold transition-colors bg-[#22c55e] hover:bg-[#16a34a] text-black disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? 'Creating...' : 'Create Workflow'}
        </button>
        <a
          href="/workflows"
          className="rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white"
        >
          Cancel
        </a>
      </div>
    </div>
  );
}
