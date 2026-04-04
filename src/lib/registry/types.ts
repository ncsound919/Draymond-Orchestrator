/**
 * Universal agent/system registry types.
 * Every entity Draymond can orchestrate — AI agents, CLI tools,
 * MCP servers, ACP services, HTTP endpoints, workflows — shares
 * this shape so the UI can auto-populate from a folder upload.
 */

export type RuntimeType =
  | 'http'      // REST/JSON endpoint (Uplift, Megacode, custom)
  | 'mcp'       // Model Context Protocol server
  | 'acp'       // Agent Communication Protocol
  | 'cli'       // Local CLI command
  | 'subprocess'// Python/Node subprocess
  | 'workflow'  // Internal Draymond workflow chain
  | 'webhook'   // Outbound webhook
  | 'grpc'      // gRPC service
  | 'ws';       // WebSocket agent

export type AgentStatus = 'online' | 'offline' | 'degraded' | 'unknown' | 'disabled';

export type AgentPersonality =
  | 'analytical' | 'creative' | 'assertive' | 'empathetic'
  | 'precise' | 'strategic' | 'playful' | 'stoic' | 'custom';

export type AgentTier = 'core' | 'specialist' | 'custom' | 'experimental';

export interface RuntimeConfig {
  type: RuntimeType;
  /** Primary endpoint or command */
  endpoint?: string;
  /** CLI command (for cli/subprocess) */
  command?: string;
  /** Additional args or headers */
  args?: string[];
  headers?: Record<string, string>;
  /** MCP server config */
  mcpServer?: string;
  mcpTools?: string[];
  /** ACP service config */
  acpService?: string;
  /** Health check path */
  healthPath?: string;
  timeoutMs?: number;
}

export interface AgentTheme {
  accentColor: string;       // hex e.g. '#6366f1'
  cardStyle: 'default' | 'holographic' | 'minimal' | 'neon' | 'glass';
  portraitFrame: 'circle' | 'hexagon' | 'shield' | 'diamond' | 'none';
  badgeColor: string;
}

export interface AgentPermissions {
  canReadFiles: boolean;
  canWriteFiles: boolean;
  canRunCommands: boolean;
  canAccessInternet: boolean;
  canAccessDatabase: boolean;
  canSendEmail: boolean;
  allowedDomains?: string[];
  maxTokensPerCall?: number;
}

export interface AgentCapability {
  id: string;
  label: string;
  description: string;
  icon?: string;
}

export interface AgentStat {
  label: string;
  value: number;   // 0–100
  color?: string;
}

export interface WorkflowRef {
  id: string;
  name: string;
  description?: string;
  path?: string;
}

export interface RegisteredAgent {
  /** Unique identifier — derived from folder name or agent.json */
  id: string;
  slug: string;
  name: string;
  codename?: string;
  version: string;
  tier: AgentTier;

  /** Bio / persona */
  role: string;
  tagline?: string;
  bio: string;
  personality: AgentPersonality;
  voice?: string;           // tone descriptor e.g. 'direct, no-nonsense'
  backstory?: string;

  /** Visual */
  avatarUrl?: string;       // resolved at import time
  coverUrl?: string;
  theme: AgentTheme;

  /** Capabilities */
  specialties: string[];    // e.g. ['TypeScript', 'REST APIs', 'Git']
  capabilities: AgentCapability[];
  stats: AgentStat[];       // radar chart data
  tags: string[];

  /** Runtime */
  runtime: RuntimeConfig;
  permissions: AgentPermissions;
  modelPreferences?: {
    primary?: string;
    fallback?: string;
    temperature?: number;
    maxTokens?: number;
  };

  /** Workflows installed with this agent */
  workflows: WorkflowRef[];

  /** System prompt / instruction file content */
  systemPrompt?: string;

  /** Memory and state */
  memoryEnabled: boolean;
  persistentMemory?: boolean;

  /** Metadata */
  status: AgentStatus;
  installedAt: string;   // ISO 8601
  updatedAt: string;
  importedFromFolder?: string;
  sourceType: 'folder' | 'registry' | 'builtin' | 'cli' | 'mcp' | 'acp';
}

export interface RegisteredWorkflow {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
  assignedAgents: string[];  // agent slugs
  trigger?: 'manual' | 'schedule' | 'webhook' | 'event';
  schedule?: string;         // cron
  tags: string[];
  installedAt: string;
  sourceType: 'folder' | 'builtin' | 'api';
}

export interface WorkflowStep {
  id: string;
  type: 'task' | 'decision' | 'parallel' | 'wait' | 'webhook' | 'condition';
  label: string;
  agent?: string;
  description?: string;
  config?: Record<string, unknown>;
}

/** Generic orchestrable system (MCP server, CLI tool, ACP service, etc.) */
export interface RegisteredSystem {
  id: string;
  name: string;
  description: string;
  type: RuntimeType;
  version?: string;
  config: RuntimeConfig;
  tags: string[];
  status: AgentStatus;
  installedAt: string;
  sourceType: 'folder' | 'config' | 'auto-detected';
}
