'use client';
/**
 * AgentBioPage — full Marvel dossier / hero bio page for /agents/[slug].
 * Shows portrait, cover, all stats, capabilities, runtime config,
 * permissions, installed workflows, and system prompt preview.
 *
 * When a matching Supabase entity is provided, also renders:
 *  - Health & status panel with live indicators
 *  - Entity capability badges
 *  - Quick action buttons (Invoke / Recover)
 */
import { useState, useTransition } from 'react';
import { RegisteredAgent } from '@/lib/registry/types';
import { invokeAgent, recoverAgent } from '@/app/agents/actions';

/** Shape of the optional Supabase entity passed from the server page. */
type EntitySnapshot = {
  id: string;
  health_status: string;
  capabilities: string[];
  is_active: boolean;
} | null;

const RUNTIME_LABELS: Record<string, string> = {
  http: 'HTTP REST',
  mcp: 'MCP Server',
  acp: 'ACP Service',
  cli: 'CLI Process',
  subprocess: 'Subprocess',
  workflow: 'Workflow Chain',
  webhook: 'Webhook',
  grpc: 'gRPC',
  ws: 'WebSocket',
};

const HEALTH_CONFIG: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  healthy:   { dot: 'bg-emerald-400', bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Healthy' },
  degraded:  { dot: 'bg-yellow-400',  bg: 'bg-yellow-500/10',  text: 'text-yellow-400',  label: 'Degraded' },
  unhealthy: { dot: 'bg-red-500',     bg: 'bg-red-500/10',     text: 'text-red-400',     label: 'Unhealthy' },
  unknown:   { dot: 'bg-slate-500',   bg: 'bg-white/5',        text: 'text-white/40',    label: 'Unknown' },
};

function StatRadar({ stats, accent }: { stats: RegisteredAgent['stats']; accent: string }) {
  return (
    <div className="space-y-2">
      {stats.map((s) => {
        const clamped = Math.max(0, Math.min(100, s.value));
        return (
          <div key={s.label}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-white/60">{s.label}</span>
              <span className="font-mono text-white/80">{clamped}</span>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${clamped}%`, background: s.color ?? accent }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PermissionPill({ label, granted }: { label: string; granted: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
        ${
          granted
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-red-500/10 text-red-400/60'
        }`}
    >
      <span>{granted ? '✓' : '✗'}</span> {label}
    </span>
  );
}

/** Interactive quick-action buttons for invoke / recover (via server actions). */
function QuickActions({ entityId }: { entityId: string }) {
  const [isPendingInvoke, startInvokeTransition] = useTransition();
  const [isPendingRecover, startRecoverTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  function handleInvoke() {
    setMessage(null);
    startInvokeTransition(async () => {
      const res = await invokeAgent(entityId);
      setMessage({ text: res.message, type: res.ok ? 'ok' : 'err' });
    });
  }

  function handleRecover() {
    setMessage(null);
    startRecoverTransition(async () => {
      const res = await recoverAgent(entityId);
      setMessage({ text: res.message, type: res.ok ? 'ok' : 'err' });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          onClick={handleInvoke}
          disabled={isPendingInvoke || isPendingRecover}
          className="flex-1 px-3 py-2 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-sm font-semibold
                     transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {isPendingInvoke ? 'Invoking...' : 'Invoke'}
        </button>
        <button
          onClick={handleRecover}
          disabled={isPendingInvoke || isPendingRecover}
          className="flex-1 px-3 py-2 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-sm font-semibold
                     transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {isPendingRecover ? 'Recovering...' : 'Recover'}
        </button>
      </div>
      {message && (
        <p
          className={`text-xs text-center ${
            message.type === 'err' ? 'text-red-400' : 'text-emerald-400'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

export default function AgentBioPage({ agent, entity }: { agent: RegisteredAgent; entity?: EntitySnapshot }) {
  const accent = agent.theme.accentColor;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Hero cover */}
      <div
        className="relative h-72 w-full"
        style={{
          background: agent.coverUrl && /^https?:\/\//i.test(agent.coverUrl)
            ? `url(${CSS.escape(agent.coverUrl)}) center/cover`
            : `linear-gradient(135deg, ${accent}44 0%, #0a0a0f 100%)`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0a0a0f]" />

        {/* Status + runtime */}
        <div className="absolute top-4 right-4 flex gap-2">
          <span className="px-3 py-1 rounded-full bg-black/60 text-xs font-mono text-white/70">
            {RUNTIME_LABELS[agent.runtime.type] ?? agent.runtime.type}
          </span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize
              ${ agent.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' :
                 agent.status === 'offline' ? 'bg-red-500/20 text-red-400' :
                 agent.status === 'degraded' ? 'bg-yellow-500/20 text-yellow-400' :
                 'bg-white/10 text-white/40' }`}
          >
            {agent.status}
          </span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 -mt-24 relative">
        <div className="flex gap-6 items-end">
          {/* Portrait */}
          <div
            className="w-36 h-36 rounded-2xl overflow-hidden border-4 flex-shrink-0"
            style={{ borderColor: accent, background: '#1a1a2e' }}
          >
            {agent.avatarUrl ? (
              <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-5xl font-black"
                style={{ color: accent }}
              >
                {agent.name[0]}
              </div>
            )}
          </div>

          {/* Name block */}
          <div className="pb-2">
            <div className="flex items-center gap-3">
              <h1 className="text-4xl font-black tracking-tight">{agent.name}</h1>
              <span
                className="px-2 py-0.5 rounded text-xs font-bold tracking-widest uppercase"
                style={{ background: accent }}
              >
                {agent.tier}
              </span>
            </div>
            {agent.codename && (
              <p className="text-white/40 font-mono text-sm mt-0.5">&ldquo;{agent.codename}&rdquo;</p>
            )}
            <p className="text-white/60 mt-1">{agent.role}</p>
            {agent.tagline && (
              <p className="text-white/40 italic mt-1 text-sm">{agent.tagline}</p>
            )}
          </div>
        </div>

        {/* Main grid */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Bio */}
            <section className="rounded-xl bg-white/5 border border-white/10 p-5">
              <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">Bio</h2>
              <p className="text-white/80 leading-relaxed whitespace-pre-wrap">{agent.bio}</p>
              {agent.backstory && (
                <p className="text-white/50 text-sm mt-3 leading-relaxed">{agent.backstory}</p>
              )}
            </section>

            {/* Capabilities */}
            {agent.capabilities.length > 0 && (
              <section className="rounded-xl bg-white/5 border border-white/10 p-5">
                <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">Capabilities</h2>
                <div className="grid grid-cols-2 gap-3">
                  {agent.capabilities.map((cap) => (
                    <div key={cap.id} className="flex gap-2">
                      {cap.icon && <span className="text-lg">{cap.icon}</span>}
                      <div>
                        <p className="text-sm font-semibold text-white/80">{cap.label}</p>
                        <p className="text-xs text-white/40">{cap.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Workflows */}
            {agent.workflows.length > 0 && (
              <section className="rounded-xl bg-white/5 border border-white/10 p-5">
                <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
                  Installed Workflows
                </h2>
                <div className="space-y-2">
                  {agent.workflows.map((wf) => (
                    <div
                      key={wf.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5"
                    >
                      <div>
                        <p className="text-sm font-medium text-white/80">{wf.name}</p>
                        {wf.description && (
                          <p className="text-xs text-white/40 mt-0.5">{wf.description}</p>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-white/30">{wf.id}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* System prompt preview */}
            {agent.systemPrompt && (
              <section className="rounded-xl bg-white/5 border border-white/10 p-5">
                <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">System Prompt</h2>
                <pre className="text-xs text-white/50 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                  {agent.systemPrompt}
                </pre>
              </section>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Entity Health & Status (from Supabase) */}
            {entity && (
              <section className="rounded-xl bg-white/5 border border-white/10 p-5">
                <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
                  System Status
                </h2>
                {(() => {
                  const h = HEALTH_CONFIG[entity.health_status] ?? HEALTH_CONFIG.unknown;
                  return (
                    <div className="space-y-3">
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${h.bg}`}>
                        <span className={`w-2.5 h-2.5 rounded-full ${h.dot} animate-pulse`} />
                        <span className={`text-sm font-semibold ${h.text}`}>{h.label}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-white/40">Active</span>
                        <span className={entity.is_active ? 'text-emerald-400' : 'text-red-400'}>
                          {entity.is_active ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </section>
            )}

            {/* Entity Capabilities (from Supabase) */}
            {entity && entity.capabilities.length > 0 && (
              <section className="rounded-xl bg-white/5 border border-white/10 p-5">
                <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
                  Registered Capabilities
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {entity.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Quick Actions (from Supabase entity) */}
            {entity && (
              <section className="rounded-xl bg-white/5 border border-white/10 p-5">
                <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
                  Quick Actions
                </h2>
                <QuickActions entityId={entity.id} />
              </section>
            )}

            {/* Stats */}
            {agent.stats.length > 0 && (
              <section className="rounded-xl bg-white/5 border border-white/10 p-5">
                <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-4">Stats</h2>
                <StatRadar stats={agent.stats} accent={accent} />
              </section>
            )}

            {/* Personality & Voice */}
            <section className="rounded-xl bg-white/5 border border-white/10 p-5">
              <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">Profile</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-white/40">Personality</dt>
                  <dd className="text-white/80 capitalize">{agent.personality}</dd>
                </div>
                {agent.voice && (
                  <div className="flex justify-between">
                    <dt className="text-white/40">Voice</dt>
                    <dd className="text-white/80 text-right max-w-32 truncate">{agent.voice}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-white/40">Memory</dt>
                  <dd className="text-white/80">{agent.memoryEnabled ? 'Enabled' : 'Off'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-white/40">Version</dt>
                  <dd className="font-mono text-white/60">{agent.version}</dd>
                </div>
              </dl>
            </section>

            {/* Runtime */}
            <section className="rounded-xl bg-white/5 border border-white/10 p-5">
              <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">Runtime</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-white/40">Type</dt>
                  <dd className="font-mono text-white/70">{agent.runtime.type.toUpperCase()}</dd>
                </div>
                {agent.runtime.endpoint && (
                  <div>
                    <dt className="text-white/40 text-xs mb-0.5">Endpoint</dt>
                    <dd className="font-mono text-xs text-white/50 break-all">{agent.runtime.endpoint}</dd>
                  </div>
                )}
                {agent.runtime.command && (
                  <div>
                    <dt className="text-white/40 text-xs mb-0.5">Command</dt>
                    <dd className="font-mono text-xs text-white/50">{agent.runtime.command}</dd>
                  </div>
                )}
                {agent.runtime.mcpServer && (
                  <div>
                    <dt className="text-white/40 text-xs mb-0.5">MCP Server</dt>
                    <dd className="font-mono text-xs text-white/50">{agent.runtime.mcpServer}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* Permissions */}
            <section className="rounded-xl bg-white/5 border border-white/10 p-5">
              <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">Permissions</h2>
              <div className="flex flex-wrap gap-1.5">
                <PermissionPill label="Read Files" granted={agent.permissions.canReadFiles} />
                <PermissionPill label="Write Files" granted={agent.permissions.canWriteFiles} />
                <PermissionPill label="Run Commands" granted={agent.permissions.canRunCommands} />
                <PermissionPill label="Internet" granted={agent.permissions.canAccessInternet} />
                <PermissionPill label="Database" granted={agent.permissions.canAccessDatabase} />
                <PermissionPill label="Email" granted={agent.permissions.canSendEmail} />
              </div>
            </section>

            {/* Specialties */}
            {agent.specialties.length > 0 && (
              <section className="rounded-xl bg-white/5 border border-white/10 p-5">
                <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">Specialties</h2>
                <div className="flex flex-wrap gap-1.5">
                  {agent.specialties.map((s) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 rounded-full text-xs"
                      style={{ background: `${accent}22`, color: accent }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
        <div className="h-16" />
      </div>
    </div>
  );
}
