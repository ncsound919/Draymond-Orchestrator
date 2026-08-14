import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  FLEET_PIPELINES,
  pipelineFor,
  stageFor,
  wiredFoldedTools,
  resolveStageRun,
  pipelineSummary,
  pipelineRequirements,
  pipelinesWithRequirements,
  installAllPipelinesCommand,
} from '../src/lib/draymond/fleet-pipelines';
import { invokeEntity } from '../src/lib/draymond/invoker';

describe('fleet pipelines', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GENERATIVE_VIDEO_URL;
    delete process.env.BOOKBRIDGE_URL;
  });

  it('has one pipeline per folded parent and wires every folded tool', () => {
    // The 9 parents that absorbed overlapping tools each own exactly one pipeline.
    const parents = ['social-media-dashboard', 'generative-video-ai', 'bookbridge', 'omniresearch-pro', 'litellm', 'agent-browser', 'ufc-mcp', 'depscan', 'trading-agents'];
    for (const p of parents) {
      const pl = pipelineFor(p);
      expect(pl, `missing pipeline for ${p}`).toBeDefined();
      expect(pl!.stages.length, `${p} should have stages`).toBeGreaterThan(0);
    }
    // Unique parent keys.
    const keys = FLEET_PIPELINES.map((p) => p.parent);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves every folded tool back to its owning pipeline', () => {
    const folded = ['overlay-marketing-voice', 'marketing-tool', 'youtube-shorts', 'content-creation-engine', 'book-synthesis', 'zvec', 'memagent', 'open-notebook', 'tap919-middleman', 'llmlingua', 'browser-use', 'scrapling', 'stirling-pdf', 'supply-chain-health', 'super-tool'];
    const wired = wiredFoldedTools();
    for (const f of folded) {
      expect(wired, `folded tool ${f} not wired`).toContain(f);
      expect(stageFor(f), `stage ${f} has no owner`).toBeDefined();
    }
  });

  it('resolves HTTP stages to an env-override-aware URL', () => {
    const gv = pipelineFor('generative-video-ai')!.stages.find((s) => s.tool === 'generative-video-ai')!;
    expect(resolveStageRun(gv)?.url).toBe('http://localhost:8055/');
    process.env.GENERATIVE_VIDEO_URL = 'https://gv.example.com/';
    expect(resolveStageRun(gv)?.url).toBe('https://gv.example.com/');
  });

  it('resolves CLI stages to a runnable command + args', () => {
    const bb = pipelineFor('bookbridge')!.stages.find((s) => s.tool === 'zvec')!;
    const run = resolveStageRun(bb);
    expect(run?.command).toBe('python');
    expect(run?.args).toContain('-m');
  });

  it('produces a pipeline summary that names the parents', () => {
    const summary = pipelineSummary();
    expect(summary).toContain('bookbridge');
    expect(summary).toContain('litellm');
    expect(summary).toContain('agent-browser');
  });

  it('points every pipeline at a consolidated dependency manifest', () => {
    const withReqs = pipelinesWithRequirements();
    expect(withReqs.length).toBe(FLEET_PIPELINES.length);
    for (const { parent, requirements } of withReqs) {
      expect(requirements, `${parent} should have a requirements path`).toBe(`pipelines/${parent}/requirements.txt`);
      expect(pipelineRequirements(parent)).toBe(requirements);
    }
    // Every manifest exists on disk next to the repo root.
    const fs = require('node:fs');
    const path = require('node:path');
    for (const { requirements } of withReqs) {
      expect(fs.existsSync(path.join(process.cwd(), requirements)), `${requirements} missing`).toBe(true);
    }
  });

  it('builds one install command per pipeline', () => {
    const cmds = installAllPipelinesCommand();
    expect(cmds.length).toBe(FLEET_PIPELINES.length);
    expect(cmds[0]).toMatch(/^pip install -r pipelines\//);
  });
});

describe('pipeline invocation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes a folded tool stage through the parent pipeline to its real entrypoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeEntity(
      {
        id: 'generative-video-ai:generative-video-ai',
        name: 'Generation studio',
        slug: 'generative-video-ai',
        kind: 'tool',
        invocation_method: 'pipeline',
        invocation_config: { pipeline: 'generative-video-ai', tool: 'generative-video-ai' },
        timeout_seconds: 60,
      },
      'run',
      { prompt: 'a cat' },
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ ok: true });
    // The synthetic entity must resolve to the studio's canonical HTTP URL.
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:8055/');
  });

  it('fails fast when the parent pipeline is unknown', async () => {
    const result = await invokeEntity(
      {
        id: 'x',
        name: 'x',
        slug: 'x',
        kind: 'tool',
        invocation_method: 'pipeline',
        invocation_config: { pipeline: 'no-such-parent', tool: 'whatever' },
        timeout_seconds: 30,
      },
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('No fleet pipeline registered');
  });

  it('fails fast when the folded tool is not a stage of the parent', async () => {
    const result = await invokeEntity(
      {
        id: 'x',
        name: 'x',
        slug: 'x',
        kind: 'tool',
        invocation_method: 'pipeline',
        invocation_config: { pipeline: 'bookbridge', tool: 'not-a-stage' },
        timeout_seconds: 30,
      },
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('is not a stage of pipeline "bookbridge"');
  });
});
