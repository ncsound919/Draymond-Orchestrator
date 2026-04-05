import type { Metadata } from 'next';
import DownloadButtons from './DownloadButtons';

export const metadata: Metadata = {
  title: 'Downloads | Uplift Ecosystem',
  description: 'Download Uplift Ecosystem tools — OmniResearch Pro, Social Media Dashboard, Uplift Agent, Sub-Team, and more.',
  robots: { index: true, follow: true },
};

// GitHub account — all repos are under this personal account
const GH = 'ncsound919';

// Actual repo names on GitHub (verified via git remote -v):
//   OmniResearch-Pro        → ncsound919/OmniResearch-Pro
//   Social-Media-Dashboard- → ncsound919/Social-Media-Dashboard-
//   Uplift-agent            → ncsound919/Uplift-agent
//   Sub-Team                → ncsound919/Sub-Team

const FREE_PRODUCTS = [
  {
    id: 'omniresearch-pro',
    name: 'OmniResearch Pro',
    tagline: 'Autonomous AI research engine — semantic sector analysis, multi-format reports',
    badge: 'Free',
    badgeColor: 'text-green-400 border-green-400/30 bg-green-400/10',
    features: [
      'Gemini-powered research agent',
      'Ollama local model support',
      'Google Drive & Notion integration',
      'SearXNG web search proxy',
      'Slack export',
    ],
    downloadUrl: `https://github.com/${GH}/OmniResearch-Pro/releases/latest/download/OmniResearch-Pro-Windows-x64.exe`,
    fileName: 'OmniResearch-Pro-Windows-x64.exe',
    setupNote: 'Runs a local server on port 3000. Create a .env file with your GEMINI_API_KEY.',
    icon: '🔬',
  },
  {
    id: 'social-media-dashboard',
    name: 'Social Media Dashboard',
    tagline: 'B2B customer engagement tracking & campaign management terminal dashboard',
    badge: 'Free',
    badgeColor: 'text-green-400 border-green-400/30 bg-green-400/10',
    features: [
      'Rich terminal UI dashboard',
      'Campaign performance analytics',
      'Customer engagement tracking',
      'Pipeline & revenue metrics',
      'Snapshot export (SVG)',
    ],
    downloadUrl: `https://github.com/${GH}/Social-Media-Dashboard-/releases/latest/download/SocialMediaDashboard-Windows-x64.exe`,
    fileName: 'SocialMediaDashboard-Windows-x64.exe',
    setupNote: 'Run directly — no setup required for the core dashboard.',
    icon: '📊',
  },
  {
    id: 'uplift-agent',
    name: 'Uplift Agent',
    tagline: 'Self-improving AI agent CLI — skills system, tool orchestration, multi-platform gateway',
    badge: 'Free',
    badgeColor: 'text-green-400 border-green-400/30 bg-green-400/10',
    features: [
      'Hermes interactive CLI agent',
      'Skills system — learns from experience',
      'File, web, terminal, and code tools',
      'Gateway: Telegram, Discord, Slack',
      'MCP server support',
    ],
    downloadUrl: `https://github.com/${GH}/Uplift-agent/releases/latest/download/hermes-Windows-x64.exe`,
    fileName: 'hermes-Windows-x64.exe',
    setupNote: 'Add ANTHROPIC_API_KEY or OPENAI_API_KEY to a .env file (or ~/.hermes/.env).',
    icon: '🤖',
  },
  {
    id: 'sub-team',
    name: 'Sub-Team',
    tagline: 'Deterministic CPU autocoding pipeline — 4-agent system from spec to verified RTL',
    badge: 'Free',
    badgeColor: 'text-green-400 border-green-400/30 bg-green-400/10',
    features: [
      'Specification Agent — constraint extraction',
      'Microarchitecture Agent — structure synthesis',
      'Implementation Agent — code generation',
      'Verification Agent — correctness proof',
      'RV32IM / 5-stage pipeline support',
    ],
    downloadUrl: `https://github.com/${GH}/Sub-Team/releases/latest/download/SubTeam-Windows-x64.exe`,
    fileName: 'SubTeam-Windows-x64.exe',
    setupNote: 'Run the EXE from terminal. Requires an OpenAI or Anthropic API key in .env.',
    icon: '🧠',
  },
] as const;

const PAID_PRODUCTS = [
  {
    id: 'sports-steve-bet-buddy',
    name: 'Sports Steve + Bet Buddy',
    tagline: 'AI-powered sports betting analytics — risk management, portfolio optimization, live odds',
    badge: '$15',
    badgeColor: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    features: [
      'Sports Steve FastAPI backend + React UI',
      'Bet Buddy risk & portfolio optimizer',
      'SQLite persistence — tracks all bets',
      'Real-time odds via lukhed-sports',
      'Circadian & budget management',
    ],
    price: 15,
    setupNote: 'Add SPORTS_STEVE_API_KEY to a .env file next to the EXE.',
    icon: '🏆',
  },
  {
    id: 'draymond-orchestrator',
    name: 'Draymond Orchestrator',
    tagline: '24/7 autonomous business system — agent fleet, chains, monitors, and pipeline orchestration',
    badge: '$20',
    badgeColor: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    features: [
      'Autonomous agent fleet management',
      'Workflow & pipeline orchestration',
      'Scheduled jobs & cron automation',
      'Site monitors & health checks',
      'Supabase-backed persistence',
    ],
    price: 20,
    setupNote: 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.',
    icon: '🎯',
  },
  {
    id: 'open-chat',
    name: 'Open Chat',
    tagline: 'Private AI-native messaging app — replaces Telegram & Signal with bot-powered conversations',
    badge: '$10',
    badgeColor: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    features: [
      'End-to-end encrypted messaging',
      'Built-in AI bot conversations',
      'Group chats with bot participants',
      'File sharing & media support',
      'Self-hosted — your data, your server',
    ],
    price: 10,
    setupNote: 'Coming soon — run the EXE to start the server, connect from any browser.',
    icon: '💬',
    comingSoon: true,
  },
] as const;

export default function DownloadsPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Page header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white tracking-tight">Downloads</h1>
        <p className="mt-2 text-white/50 text-sm">
          Windows x64 EXE installers — download, run, and go.
        </p>
      </div>

      {/* Free products */}
      <section className="mb-12">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-4">
          Free Tools
        </h2>
        <div className="grid gap-4">
          {FREE_PRODUCTS.map((product) => (
            <div
              key={product.id}
              className="rounded-xl border border-white/8 bg-white/[0.03] p-6 flex flex-col sm:flex-row gap-5"
            >
              {/* Icon */}
              <div className="flex-shrink-0 text-3xl">{product.icon}</div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="text-base font-semibold text-white">{product.name}</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${product.badgeColor}`}>
                    {product.badge}
                  </span>
                </div>
                <p className="text-sm text-white/50 mb-3">{product.tagline}</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 mb-3">
                  {product.features.map((f) => (
                    <li key={f} className="text-xs text-white/40 flex items-start gap-1.5">
                      <span className="text-green-500 mt-0.5">+</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-white/30 italic">{product.setupNote}</p>
              </div>

              {/* Download button */}
              <div className="flex-shrink-0 flex items-start sm:items-center">
                <a
                  href={product.downloadUrl}
                  download={product.fileName}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-[#0a0a0a] font-semibold text-sm transition-colors whitespace-nowrap"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download .exe
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Paid products */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-4">
          Premium Tools
        </h2>
        <div className="grid gap-4">
          {PAID_PRODUCTS.map((product) => (
            <div
              key={product.id}
              className={`rounded-xl border p-6 flex flex-col sm:flex-row gap-5 ${
                'comingSoon' in product && product.comingSoon
                  ? 'border-white/8 bg-white/[0.02] opacity-75'
                  : 'border-yellow-400/15 bg-yellow-400/[0.03]'
              }`}
            >
              {/* Icon */}
              <div className="flex-shrink-0 text-3xl">{product.icon}</div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="text-base font-semibold text-white">{product.name}</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${product.badgeColor}`}>
                    {product.badge}
                  </span>
                  {'comingSoon' in product && product.comingSoon && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full border text-white/40 border-white/20 bg-white/5">
                      Coming Soon
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/50 mb-3">{product.tagline}</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 mb-3">
                  {product.features.map((f) => (
                    <li key={f} className="text-xs text-white/40 flex items-start gap-1.5">
                      <span className="text-yellow-500 mt-0.5">+</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-white/30 italic">{product.setupNote}</p>
              </div>

              {/* Download / Purchase button */}
              <div className="flex-shrink-0 flex items-start sm:items-center">
                {'comingSoon' in product && product.comingSoon ? (
                  <div className="flex flex-col items-end gap-1">
                    <button
                      disabled
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white/30 font-semibold text-sm cursor-not-allowed whitespace-nowrap"
                    >
                      Coming Soon
                    </button>
                    <p className="text-xs text-white/20">${product.price}</p>
                  </div>
                ) : (
                  <DownloadButtons productId={product.id} price={product.price} />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Platform note */}
      <p className="mt-10 text-center text-xs text-white/20">
        Windows x64 only &mdash; macOS and Linux coming soon.
      </p>
    </div>
  );
}
