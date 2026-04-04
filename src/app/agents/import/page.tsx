'use client';
import FolderImportWizard from '@/components/registry/FolderImportWizard';
import { useRouter } from 'next/navigation';

export default function ImportPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen text-white px-6 py-12">
      <div className="max-w-xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">Import Agent Pack</h1>
          <p className="text-white/40 mt-2 text-sm">
            Upload a local folder containing an agent pack. Supports AI agents,
            MCP servers, ACP services, CLI tools, and custom HTTP workers.
          </p>
        </div>

        {/* Format reference */}
        <div className="mb-6 rounded-xl bg-white/5 border border-white/10 p-4">
          <p className="text-xs font-bold tracking-widest uppercase text-white/30 mb-3">Expected folder format</p>
          <pre className="text-xs font-mono text-white/50 leading-relaxed">{
`my-agent/
  agent.json        ← required manifest
  bio.md            ← personality & backstory
  system.md         ← system prompt
  avatar.png        ← portrait image
  cover.png         ← hero / cover image
  tools.json        ← permission overrides
  mcp.json          ← MCP server config
  acp.json          ← ACP service config
  cli.json          ← CLI runtime config
  workflows/
    onboard.json
    daily-report.json`
          }</pre>
        </div>

        <FolderImportWizard onImported={() => router.push('/agents')} />
      </div>
    </div>
  );
}
