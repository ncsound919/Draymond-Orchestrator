'use client';
/**
 * AgentCard — Marvel-style character card for the /agents grid.
 * Displays portrait, name, role, personality badge, stats bar,
 * status indicator, and accent colour from the agent's theme.
 */
import { RegisteredAgent } from '@/lib/registry/types';
import Link from 'next/link';

const PERSONALITY_COLORS: Record<string, string> = {
  analytical: '#60a5fa',
  creative:   '#f472b6',
  assertive:  '#f97316',
  empathetic: '#34d399',
  precise:    '#a78bfa',
  strategic:  '#facc15',
  playful:    '#fb7185',
  stoic:      '#94a3b8',
  custom:     '#6366f1',
};

const STATUS_DOT: Record<string, string> = {
  online:   'bg-emerald-400',
  offline:  'bg-red-500',
  degraded: 'bg-yellow-400',
  unknown:  'bg-slate-500',
  disabled: 'bg-slate-700',
};

const RUNTIME_BADGE: Record<string, string> = {
  http:       'HTTP',
  mcp:        'MCP',
  acp:        'ACP',
  cli:        'CLI',
  subprocess: 'PROC',
  workflow:   'FLOW',
  webhook:    'HOOK',
  grpc:       'gRPC',
  ws:         'WS',
};

const FRAME_CLIP: Record<string, string> = {
  hexagon: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
  shield:  'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  circle:  '',
  none:    '',
};

export default function AgentCard({ agent }: { agent: RegisteredAgent }) {
  const accent = agent.theme.accentColor;
  const personalityColor = PERSONALITY_COLORS[agent.personality] ?? '#6366f1';
  const clip = FRAME_CLIP[agent.theme.portraitFrame] ?? '';

  /** Sanitize URLs for use in CSS background-image to prevent CSS injection */
  const safeCoverUrl = agent.coverUrl
    ? agent.coverUrl.replace(/['"()\\;{}]/g, '')
    : undefined;

  return (
    <Link
      href={`/agents/${agent.slug}`}
      className="group block relative rounded-2xl overflow-hidden border border-white/10
                 bg-gradient-to-b from-white/5 to-white/[0.02] backdrop-blur-sm
                 hover:border-white/20 transition-all duration-300
                 hover:shadow-2xl hover:-translate-y-1"
      style={{ boxShadow: `0 0 0 0 ${accent}` }}
    >
      {/* Cover image / gradient hero */}
      <div
        className="relative h-36 w-full overflow-hidden"
        style={{
          background: safeCoverUrl
            ? `url(${safeCoverUrl}) center/cover`
            : `linear-gradient(135deg, ${accent}33, ${accent}11)`,
        }}
      >
        {/* Tier badge */}
        <span
          className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase"
          style={{ background: accent, color: '#fff' }}
        >
          {agent.tier}
        </span>

        {/* Runtime badge */}
        <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/50 text-[10px] font-mono text-white/70">
          {RUNTIME_BADGE[agent.runtime.type] ?? agent.runtime.type.toUpperCase()}
        </span>

        {/* Status dot */}
        <span className="absolute bottom-2 right-2 flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status] ?? 'bg-slate-500'}`} />
          <span className="text-[10px] text-white/50 capitalize">{agent.status}</span>
        </span>
      </div>

      {/* Portrait */}
      <div className="absolute top-20 left-4">
        <div
          className="w-16 h-16 rounded-full border-2 overflow-hidden bg-slate-800"
          style={{
            borderColor: accent,
            clipPath: clip || undefined,
          }}
        >
          {agent.avatarUrl ? (
            <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-2xl font-bold"
              style={{ color: accent }}
            >
              {(agent.name || '?')[0]}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="pt-10 px-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-white font-bold text-base leading-tight">{agent.name}</h3>
            {agent.codename && (
              <p className="text-white/40 text-xs font-mono">{agent.codename}</p>
            )}
            <p className="text-white/60 text-xs mt-0.5">{agent.role}</p>
          </div>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
            style={{ background: `${personalityColor}22`, color: personalityColor }}
          >
            {agent.personality}
          </span>
        </div>

        {agent.tagline && (
          <p className="text-white/40 text-xs mt-2 italic line-clamp-1">&ldquo;{agent.tagline}&rdquo;</p>
        )}

        {/* Specialty tags */}
        {agent.specialties.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {agent.specialties.slice(0, 3).map((s) => (
              <span
                key={s}
                className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-white/50"
              >
                {s}
              </span>
            ))}
            {agent.specialties.length > 3 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-white/40">
                +{agent.specialties.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Mini stat bars */}
        {agent.stats.length > 0 && (
          <div className="mt-3 space-y-1">
            {agent.stats.slice(0, 3).map((stat) => (
              <div key={stat.label} className="flex items-center gap-2">
                <span className="text-[9px] text-white/30 w-14 truncate">{stat.label}</span>
                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${stat.value}%`, background: stat.color ?? accent }}
                  />
                </div>
                <span className="text-[9px] text-white/30 w-5 text-right">{stat.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
