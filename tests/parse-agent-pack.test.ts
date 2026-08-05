import { describe, expect, it } from 'vitest';
import { parseAgentPack } from '../src/lib/registry/parse-agent-pack';

function mapOf(files: Record<string, string>): Record<string, string> {
  return files;
}

describe('parseAgentPack', () => {
  it('parses a minimal agent.json with sensible defaults', () => {
    const { agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({ name: 'Rex', slug: 'rex', role: 'Sales Agent' }),
      }),
      'rex-pack',
    );

    expect(agent.name).toBe('Rex');
    expect(agent.slug).toBe('rex');
    expect(agent.role).toBe('Sales Agent');
    expect(agent.tier).toBe('custom');
    expect(agent.version).toBe('1.0.0');
    expect(agent.personality).toBe('analytical');
    expect(agent.memoryEnabled).toBe(true);
    expect(agent.persistentMemory).toBe(false);
    expect(agent.runtime.type).toBe('http');
    expect(agent.runtime.healthPath).toBe('/health');
    expect(agent.runtime.timeoutMs).toBe(30_000);
    expect(agent.importedFromFolder).toBe('rex-pack');
    expect(agent.sourceType).toBe('folder');
    expect(agent.workflows).toEqual([]);
  });

  it('falls back to folder name for name and slugifies it', () => {
    const { agent } = parseAgentPack(mapOf({ 'agent.json': '{}' }), 'My Cool Agent');
    expect(agent.name).toBe('My Cool Agent');
    expect(agent.slug).toBe('my-cool-agent');
  });

  it('reads bio.md as the long bio', () => {
    const { agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({ name: 'X', slug: 'x' }),
        'bio.md': '# Long bio here',
      }),
      'x',
    );
    expect(agent.bio).toContain('Long bio');
  });

  it('loads system.md as the system prompt', () => {
    const { agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({ name: 'X', slug: 'x' }),
        'system.md': 'You are a specialist.',
      }),
      'x',
    );
    expect(agent.systemPrompt).toContain('specialist');
  });

  it('detects mcp runtime from mcp.json', () => {
    const { agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({ name: 'X', slug: 'x' }),
        'mcp.json': JSON.stringify({ mcpServer: 'npx', mcpTools: ['t1'] }),
      }),
      'x',
    );
    expect(agent.runtime.type).toBe('mcp');
    expect(agent.runtime.mcpServer).toBe('npx');
  });

  it('detects cli runtime from cli.json', () => {
    const { agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({ name: 'X', slug: 'x' }),
        'cli.json': JSON.stringify({ command: 'python', args: ['run.py'] }),
      }),
      'x',
    );
    expect(agent.runtime.type).toBe('cli');
    expect(agent.runtime.command).toBe('python');
  });

  it('honours an explicit runtime block in the manifest', () => {
    const { agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({
          name: 'X',
          slug: 'x',
          runtime: { type: 'http', endpoint: 'https://example.com/x', healthPath: '/ping', timeoutMs: 5000 },
        }),
      }),
      'x',
    );
    expect(agent.runtime.type).toBe('http');
    expect(agent.runtime.endpoint).toBe('https://example.com/x');
    expect(agent.runtime.healthPath).toBe('/ping');
    expect(agent.runtime.timeoutMs).toBe(5000);
  });

  it('parses permissions from tools.json', () => {
    const { agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({ name: 'X', slug: 'x' }),
        'tools.json': JSON.stringify({ canWriteFiles: true, canRunCommands: true }),
      }),
      'x',
    );
    expect(agent.permissions.canWriteFiles).toBe(true);
    expect(agent.permissions.canRunCommands).toBe(true);
    expect(agent.permissions.canAccessInternet).toBe(true); // default preserved
  });

  it('captures images (avatar/cover) as data URLs', () => {
    const { images, agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({ name: 'X', slug: 'x' }),
        'avatar.png': 'data:image/png;base64,AAAA',
        'cover.jpg': 'data:image/jpeg;base64,BBBB',
      }),
      'x',
    );
    expect(agent.avatarUrl).toContain('data:image/png');
    expect(agent.coverUrl).toContain('data:image/jpeg');
    expect(Object.keys(images)).toContain('avatar.png');
  });

  it('parses workflow files into RegisteredWorkflows', () => {
    const { workflows } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({ name: 'X', slug: 'x' }),
        'workflows/daily.json': JSON.stringify({
          id: 'wf-1',
          name: 'Daily Report',
          description: 'Runs daily',
          version: '2.0.0',
          steps: [{ name: 'step-1' }],
        }),
      }),
      'x',
    );
    expect(workflows).toHaveLength(1);
    expect(workflows[0].name).toBe('Daily Report');
    expect(workflows[0].description).toBe('Runs daily');
    expect(workflows[0].version).toBe('2.0.0');
    expect(workflows[0].assignedAgents).toEqual(['x']);
    expect(workflows[0].trigger).toBe('manual');
  });

  it('preserves manifest theme and stats', () => {
    const { agent } = parseAgentPack(
      mapOf({
        'agent.json': JSON.stringify({
          name: 'X',
          slug: 'x',
          theme: { accentColor: '#f97316', cardStyle: 'neon' },
          stats: [{ label: 'Speed', value: 95 }],
        }),
      }),
      'x',
    );
    expect(agent.theme.accentColor).toBe('#f97316');
    expect(agent.theme.cardStyle).toBe('neon');
    expect(agent.stats).toEqual([{ label: 'Speed', value: 95 }]);
  });
});
