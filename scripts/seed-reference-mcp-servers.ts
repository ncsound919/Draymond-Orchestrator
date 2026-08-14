// Register the maintained reference MCP servers (modelcontextprotocol/servers)
// as fleet entities so OPS-CATALOG, monitors, and chain steps can address them.
// Idempotent (upsert on slug) — safe to run repeatedly.
//
// Usage: npm run seed:mcp
import { registerEntities } from '../src/lib/draymond/registry';
import type { DraymondEntityInsert } from '../src/lib/draymond/types';

const REFERENCE_MCP_SERVERS: Array<Partial<DraymondEntityInsert> & { slug: string; name: string }> = [
  {
    slug: 'mcp-filesystem',
    name: 'Filesystem MCP',
    kind: 'mcp_server',
    invocation_method: 'mcp_stdio',
    invocation_config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
    capabilities: ['file-ops', 'document-access'],
    description: 'Maintained reference MCP server — secure, scoped file operations with access controls.',
  },
  {
    slug: 'mcp-memory',
    name: 'Memory MCP',
    kind: 'mcp_server',
    invocation_method: 'mcp_stdio',
    invocation_config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    capabilities: ['knowledge-graph', 'memory'],
    description: 'Maintained reference MCP server — persistent knowledge-graph memory; a natural projection of the .draymond brain state.',
  },
  {
    slug: 'mcp-git',
    name: 'Git MCP',
    kind: 'mcp_server',
    invocation_method: 'mcp_stdio',
    invocation_config: {
      command: 'uvx',
      args: ['mcp-server-git'],
    },
    capabilities: ['git', 'repo-ops'],
    description: 'Maintained reference MCP server — read/search/manipulate git repositories across the fleet.',
  },
  {
    slug: 'mcp-sequential-thinking',
    name: 'Sequential Thinking MCP',
    kind: 'mcp_server',
    invocation_method: 'mcp_stdio',
    invocation_config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
    capabilities: ['reasoning', 'planning'],
    description: 'Maintained reference MCP server — structured multi-step reasoning for the orchestrator.',
  },
  {
    slug: 'mcp-fetch',
    name: 'Fetch MCP',
    kind: 'mcp_server',
    invocation_method: 'mcp_stdio',
    invocation_config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
    },
    capabilities: ['web-fetch', 'research'],
    description: 'Maintained reference MCP server — web fetch and conversion for research pipelines.',
  },
  {
    slug: 'mcp-time',
    name: 'Time MCP',
    kind: 'mcp_server',
    invocation_method: 'mcp_stdio',
    invocation_config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-time'],
    },
    capabilities: ['time', 'timezone'],
    description: 'Maintained reference MCP server — timezone-aware time utilities for the scheduler.',
  },
  {
    slug: 'mcp-postgres',
    name: 'PostgreSQL MCP',
    kind: 'mcp_server',
    invocation_method: 'mcp_stdio',
    invocation_config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
    },
    capabilities: ['database', 'postgres'],
    description: 'Maintained reference MCP server — schema-inspected read/query access to PostgreSQL.',
  },
  {
    slug: 'mcp-github',
    name: 'GitHub MCP',
    kind: 'mcp_server',
    invocation_method: 'mcp_stdio',
    invocation_config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    },
    capabilities: ['github', 'repos', 'issues', 'prs'],
    description: 'Maintained reference MCP server — repo, issue, and PR automation against GitHub.',
  },
];

async function main() {
  const inputs = REFERENCE_MCP_SERVERS.map((s) => ({
    name: s.name,
    slug: s.slug,
    kind: s.kind,
    description: s.description,
    invocation_method: s.invocation_method,
    invocation_config: s.invocation_config,
    capabilities: s.capabilities,
    is_active: true,
  })) as DraymondEntityInsert[];

  const result = await registerEntities(inputs);
  console.log(
    `Reference MCP servers registered: ${result.registered} ok, ${result.errors.length} errors.`
  );
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error('  -', e);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
