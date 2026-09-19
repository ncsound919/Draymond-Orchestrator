/**
 * parse-agent-pack.ts
 *
 * Parses a flat file map (path → string content) produced by the
 * FolderImportWizard client component and builds a RegisteredAgent.
 *
 * Expected folder structure:
 *   agent.json          — required manifest
 *   bio.md              — long bio / persona (optional)
 *   system.md           — system prompt (optional)
 *   avatar.(png|jpg|webp|gif) — portrait (optional, stored as data URL)
 *   cover.(png|jpg|webp)     — hero image (optional)
 *   workflows/*.json    — workflow definitions (optional)
 *   tools.json          — tool permission overrides (optional)
 *   mcp.json            — MCP server config (optional)
 *   acp.json            — ACP service config (optional)
 *   cli.json            — CLI runtime config (optional)
 *
 * The parser is intentionally permissive — missing fields get
 * sensible defaults so a minimal agent.json is enough to import.
 */
import { randomUUID } from 'crypto';
import {
  RegisteredAgent, RegisteredWorkflow, AgentTheme,
  AgentPermissions, AgentStat, RuntimeConfig, RuntimeType,
} from './types';

export interface ParsedAgentPack {
  agent: RegisteredAgent;
  workflows: RegisteredWorkflow[];
  /** base64 data URLs keyed by filename, for avatar/cover */
  images: Record<string, string>;
}

export interface FileMap {
  /** path relative to folder root → file content as string or base64 */
  [relativePath: string]: string;
}

// -- Defaults -----------------------------------------------------------------

const DEFAULT_THEME: AgentTheme = {
  accentColor: '#6366f1',
  cardStyle: 'glass',
  portraitFrame: 'hexagon',
  badgeColor: '#6366f1',
};

const DEFAULT_PERMISSIONS: AgentPermissions = {
  canReadFiles: false,
  canWriteFiles: false,
  canRunCommands: false,
  canAccessInternet: true,
  canAccessDatabase: false,
  canSendEmail: false,
};

const DEFAULT_STATS: AgentStat[] = [
  { label: 'Speed',       value: 70 },
  { label: 'Accuracy',    value: 80 },
  { label: 'Creativity',  value: 60 },
  { label: 'Autonomy',    value: 50 },
  { label: 'Reliability', value: 75 },
];

// -- Helpers -------------------------------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function safeJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return null; }
}

function findFile(files: FileMap, patterns: string[]): string | undefined {
  for (const p of patterns) {
    const key = Object.keys(files).find(
      (k) => k.toLowerCase().endsWith(p.toLowerCase())
    );
    if (key) return files[key];
  }
  return undefined;
}

function detectRuntimeType(files: FileMap): RuntimeType {
  if (Object.keys(files).some((k) => k.endsWith('mcp.json'))) return 'mcp';
  if (Object.keys(files).some((k) => k.endsWith('acp.json'))) return 'acp';
  if (Object.keys(files).some((k) => k.endsWith('cli.json'))) return 'cli';
  return 'http';
}

function parseRuntime(files: FileMap, manifest: Record<string, unknown>): RuntimeConfig {
  // Explicit runtime in manifest wins
  if (manifest.runtime && typeof manifest.runtime === 'object') {
    return manifest.runtime as RuntimeConfig;
  }
  const rtype = detectRuntimeType(files);
  const cfgRaw = findFile(files, [`${rtype}.json`]);
  const cfg = cfgRaw ? (safeJson(cfgRaw) ?? {}) : {};
  return {
    type: rtype,
    endpoint: cfg.endpoint as string | undefined
      ?? (manifest.endpoint as string | undefined),
    command: cfg.command as string | undefined,
    healthPath: cfg.healthPath as string ?? '/health',
    timeoutMs: (cfg.timeoutMs as number) ?? 30_000,
    mcpServer: cfg.mcpServer as string | undefined,
    mcpTools: cfg.mcpTools as string[] | undefined,
    acpService: cfg.acpService as string | undefined,
  };
}

// -- Main parser ---------------------------------------------------------------

export function parseAgentPack(
  files: FileMap,
  folderName: string,
): ParsedAgentPack {
  // 1. Read manifest
  const manifestRaw = findFile(files, ['agent.json']);
  const manifest: Record<string, unknown> = manifestRaw
    ? (safeJson(manifestRaw) ?? {})
    : {};

  const name = (manifest.name as string) ?? folderName;
  const slug = (manifest.slug as string) ?? slugify(name);
  const id   = (manifest.id   as string) ?? randomUUID();
  const now  = new Date().toISOString();

  // 2. Bio
  const bioMd = findFile(files, ['bio.md', 'persona.md', 'README.md']);
  const bio = (manifest.bio as string) ?? bioMd ?? `${name} — imported agent.`;

  // 3. System prompt
  const systemPrompt = findFile(files, ['system.md', 'system.txt', 'prompt.md']);

  // 4. Runtime
  const runtime = parseRuntime(files, manifest);

  // 5. Theme
  const theme: AgentTheme = {
    ...DEFAULT_THEME,
    ...((manifest.theme as Partial<AgentTheme>) ?? {}),
  };

  // 6. Permissions
  const toolsRaw = findFile(files, ['tools.json', 'permissions.json']);
  const toolsCfg = toolsRaw ? (safeJson(toolsRaw) ?? {}) : {};
  const permissions: AgentPermissions = { ...DEFAULT_PERMISSIONS, ...toolsCfg };

  // 7. Stats — use manifest if provided, else defaults
  const stats: AgentStat[] =
    Array.isArray(manifest.stats)
      ? (manifest.stats as AgentStat[])
      : DEFAULT_STATS;

  // 8. Images (returned as data URLs — consumer stores or proxies them)
  const images: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    const lower = k.toLowerCase();
    if (
      lower.endsWith('.png') || lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') || lower.endsWith('.webp') ||
      lower.endsWith('.gif')
    ) {
      images[path.basename(k)] = v; // caller provides as data URL already
    }
  }

  const avatarKey = Object.keys(images).find((k) =>
    k.startsWith('avatar') || k.startsWith('portrait'));
  const coverKey  = Object.keys(images).find((k) =>
    k.startsWith('cover') || k.startsWith('hero'));

  // 9. Workflows
  const workflows: RegisteredWorkflow[] = [];
  for (const [k, v] of Object.entries(files)) {
    if (k.includes('workflow') && k.endsWith('.json')) {
      const wf = safeJson(v);
      if (wf) {
        workflows.push({
          id: (wf.id as string) ?? randomUUID(),
          name: (wf.name as string) ?? k,
          description: (wf.description as string) ?? '',
          version: (wf.version as string) ?? '1.0.0',
          steps: (wf.steps as RegisteredWorkflow['steps']) ?? [],
          assignedAgents: [slug],
          trigger: (wf.trigger as RegisteredWorkflow['trigger']) ?? 'manual',
          tags: (wf.tags as string[]) ?? [],
          installedAt: now,
          sourceType: 'folder',
        });
      }
    }
  }

  // 10. Assemble agent
  const agent: RegisteredAgent = {
    id,
    slug,
    name,
    codename: manifest.codename as string | undefined,
    version: (manifest.version as string) ?? '1.0.0',
    tier: (manifest.tier as RegisteredAgent['tier']) ?? 'custom',
    role: (manifest.role as string) ?? 'Assistant',
    tagline: manifest.tagline as string | undefined,
    bio,
    personality: (manifest.personality as RegisteredAgent['personality']) ?? 'analytical',
    voice: manifest.voice as string | undefined,
    backstory: manifest.backstory as string | undefined,
    avatarUrl: avatarKey ? images[avatarKey] : undefined,
    coverUrl: coverKey ? images[coverKey] : undefined,
    theme,
    specialties: (manifest.specialties as string[]) ?? [],
    capabilities: (manifest.capabilities as RegisteredAgent['capabilities']) ?? [],
    stats,
    tags: (manifest.tags as string[]) ?? [],
    runtime,
    permissions,
    modelPreferences: manifest.modelPreferences as RegisteredAgent['modelPreferences'],
    workflows: workflows.map((w) => ({ id: w.id, name: w.name, description: w.description })),
    systemPrompt,
    memoryEnabled: (manifest.memoryEnabled as boolean) ?? true,
    persistentMemory: (manifest.persistentMemory as boolean) ?? false,
    status: 'unknown',
    installedAt: now,
    updatedAt: now,
    importedFromFolder: folderName,
    sourceType: 'folder',
  };

  return { agent, workflows, images };
}

// Import path helper used server-side
import path from 'path';
