import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Downloads | Draymond Orchestrator',
  description: 'Download Open Chat — the private, local-first messaging app for your agent fleet.',
  robots: { index: true, follow: true },
};

const OPENCHAT_RELEASE_URL = 'https://github.com/ncsound919/Open-Chat/releases';

export default function DownloadsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-white tracking-tight">Downloads</h1>
        <p className="mt-2 text-white/50 text-sm">
          The one app you need to talk to your fleet.
        </p>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-6 sm:p-8">
        <div className="flex items-start gap-5 flex-col sm:flex-row">
          {/* Icon */}
          <div className="flex-shrink-0 text-4xl">💬</div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h2 className="text-xl font-semibold text-white">Open Chat</h2>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full border text-green-400 border-green-400/30 bg-green-400/10">
                Android APK + Desktop
              </span>
            </div>
            <p className="text-sm text-white/60 mb-4">
              A private, local-first messaging app that replaces Telegram and Signal as the control
              surface for your autonomous agents. Chat with every agent in the Draymond roster
              through one clean interface — OpenClaw, Hermes, Draymond, and ntfy.
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mb-6">
              {[
                'Chat with every fleet agent in one UI',
                'Local-first — zero telemetry, 100% private',
                'Token-by-token streaming & markdown',
                'Multi-protocol: OpenClaw, Hermes, Draymond, ntfy',
                'Android app, Electron desktop, and web',
                'Draymond remote management built in',
              ].map((f) => (
                <li key={f} className="text-sm text-white/50 flex items-start gap-1.5">
                  <span className="text-green-500 mt-0.5">+</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Download button */}
        <div className="flex flex-wrap gap-3 sm:justify-end">
          <a
            href={`${OPENCHAT_RELEASE_URL}/latest`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#22c55e] hover:bg-[#16a34a] text-[#0a0a0a] font-semibold text-sm transition-colors whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download from GitHub Releases
          </a>
          <a
            href="https://github.com/ncsound919/Open-Chat"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-semibold transition-colors whitespace-nowrap"
          >
            Android APK &amp; source on GitHub
          </a>
        </div>
      </div>

      <p className="text-center text-xs text-white/30 mt-8">
        Draymond Orchestrator itself is available via this repository&apos;s GitHub Releases.
      </p>
    </div>
  );
}
