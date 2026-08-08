import { describe, expect, it } from 'vitest';
import { SEED_ENTITIES } from '../src/lib/draymond/seed';

function bySlug(slug: string) {
  return SEED_ENTITIES.find((e) => e.slug === slug);
}

describe('internal tool registrations', () => {
  it('registers Mutly as a multi-endpoint http_api entity', () => {
    const mutly = bySlug('mutly');
    expect(mutly).toBeDefined();
    expect(mutly!.kind).toBe('tool');
    expect(mutly!.invocation_method).toBe('http_api');

    const config = mutly!.invocation_config as { url: string; endpoints: Record<string, { path: string; method: string }> };
    expect(config.url).toContain('localhost:4000');
    expect(config.endpoints.analyze.path).toBe('/api/agent/analyze');
    expect(config.endpoints.symbols.method).toBe('GET');
    expect(config.endpoints.reporank_milestones.path).toBe('/api/reporank/milestones');
    expect(config.endpoints.reporank_gates.path).toBe('/api/reporank/gates/:id/evaluate');
    expect(config.endpoints.vibeserve_tools.path).toBe('/api/vibeserve/tools/:toolName');
    expect(config.endpoints.claw_protect_audit.path).toBe('/api/claw-protect/audit');
  });

  it('registers AgentBrowser as an http_api entity with browser endpoints', () => {
    const ab = bySlug('agent-browser');
    expect(ab).toBeDefined();
    expect(ab!.invocation_method).toBe('http_api');

    const config = ab!.invocation_config as { url: string; endpoints: Record<string, { path: string; method: string }> };
    expect(config.url).toContain('localhost:3700');
    expect(config.endpoints.browser_task.path).toBe('/api/browser-task');
    expect(config.endpoints.site_tests.method).toBe('GET');
  });

  it('registers UFC-MCP with a working mcp_stdio transport', () => {
    const ufc = bySlug('ufc-mcp');
    expect(ufc).toBeDefined();
    expect(ufc!.kind).toBe('mcp_server');
    expect(ufc!.invocation_method).toBe('mcp_stdio');

    const config = ufc!.invocation_config as { command: string; args: string[]; cwd: string };
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['dist/index.js']);
    expect(config.cwd).toBe('agents/UFC-MCP-main');
    // tool_name omitted so the action drives the convert_* tool
    expect((ufc!.invocation_config as { tool_name?: string }).tool_name).toBeUndefined();
  });

  it('registers Graphify as an MCP stdio knowledge-graph tool', () => {
    const g = bySlug('graphify');
    expect(g).toBeDefined();
    expect(g!.invocation_method).toBe('mcp_stdio');
    const config = g!.invocation_config as { command: string; args: string[]; cwd: string };
    expect(config.command).toBe('python');
    expect(config.args).toContain('-m');
    expect(config.args).toContain('graphify.serve');
    expect(config.cwd).toBe('.');
  });

  it('registers the Deterministic Brain as an http_api observer with sweep/status', () => {
    const b = bySlug('deterministic-brain');
    expect(b).toBeDefined();
    expect(b!.kind).toBe('tool');
    expect(b!.invocation_method).toBe('http_api');
    const config = b!.invocation_config as { url: string; endpoints: Record<string, { path: string; method: string }> };
    expect(config.url).toContain('localhost:3210');
    expect(config.endpoints.sweep.path).toBe('/brain/sweep');
    expect(config.endpoints.status.path).toBe('/brain/status');
    expect(config.endpoints.status.method).toBe('GET');
  });

  it('registers Kaggle as an http_api data provider through Draymond', () => {
    const k = bySlug('kaggle');
    expect(k).toBeDefined();
    expect(k!.kind).toBe('tool');
    expect(k!.invocation_method).toBe('http_api');

    const config = k!.invocation_config as { url: string; endpoints: Record<string, { path: string; method: string }> };
    // Kaggle is proxied through Draymond's /api/ops/kaggle (the brain's
    // /kaggle/* routes were never implemented).
    expect(config.url).toContain('localhost:3444');
    expect(config.endpoints.status.path).toBe('/api/ops/kaggle/status');
    expect(config.endpoints.search.path).toBe('/api/ops/kaggle');
    expect(config.endpoints.search.method).toBe('POST');
    expect(config.endpoints.competitions.path).toBe('/api/ops/kaggle');
  });

  it('registers OmniResearch as depending on Kaggle for research data', () => {
    const o = bySlug('omni-research');
    expect(o).toBeDefined();
    expect(o!.depends_on).toContain('kaggle');
  });
});
