import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchPapersForTopic, refreshGoalPapers, papersForGoal, papersSummary, hypothesisPaperEvidence } from '@/lib/science/papers';

let tmpDir: string;

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

describe('science papers', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'science-papers-'));
    process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
    mockFetch.mockReset();
  });

  afterEach(() => {
    delete process.env.DRAYMOND_REGISTRY_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockOpenAlex(): void {
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('api.openalex.org')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              { id: 'https://openalex.org/W1', title: 'Cancer early detection biomarker study', publication_year: 2024, doi: 'https://doi.org/10.1/abc', authorships: [{ author: { display_name: 'A. Author' } }] },
              { id: 'https://openalex.org/W2', title: 'Fatigue load and injury risk in athletes', publication_year: 2023, doi: 'https://doi.org/10.1/def', authorships: [] },
            ],
          }),
        };
      }
      // PubMed esearch
      return { ok: true, json: async () => ({ esearchresult: { idlist: ['1'] } }) };
    });
  }

  it('fetchPapersForTopic returns deduped keyless papers', async () => {
    mockOpenAlex();
    const papers = await fetchPapersForTopic('cancer early detection', 5);
    expect(papers.length).toBeGreaterThan(0);
    expect(papers[0].title).toContain('Cancer early detection');
    expect(papers[0].source).toBe('openalex');
    expect(papers[0].url).toContain('doi.org');
  });

  it('refreshGoalPapers caches papers per goal', async () => {
    mockOpenAlex();
    const { saveGoals } = await import('@/lib/science/goals');
    await saveGoals([
      { id: 'biotech-01', domain: 'biotech', area: 'Early Detection', title: 'Detect cancers early', opportunity: 'o', rationale: 'r', base_weight: 1, cross_domain_value: 0.4, status: 'active', model_id: 'm1', hypothesis_ids: [] },
      { id: 'sports-03', domain: 'sports', area: 'Biological Load', title: 'Predict fatigue thresholds', opportunity: 'o', rationale: 'r', base_weight: 1, cross_domain_value: 0.8, status: 'active', model_id: 'm3', hypothesis_ids: [] },
    ]);
    const rows = await refreshGoalPapers(true);
    expect(rows.length).toBe(2);
    const papers = await papersForGoal('biotech-01');
    expect(papers.length).toBeGreaterThan(0);
    const sum = await papersSummary();
    expect(sum.reduce((a, s) => a + s.count, 0)).toBeGreaterThan(0);
  });

  it('hypothesisPaperEvidence returns a short evidence line from cached papers', async () => {
    mockOpenAlex();
    const { saveGoals, saveHypotheses } = await import('@/lib/science/goals');
    await saveGoals([
      { id: 'biotech-01', domain: 'biotech', area: 'Early Detection', title: 'Detect cancers early', opportunity: 'o', rationale: 'r', base_weight: 1, cross_domain_value: 0.4, status: 'active', model_id: 'm1', hypothesis_ids: ['h1'] },
    ]);
    await saveHypotheses([{ id: 'h1', goal_id: 'biotech-01', claim: 'biomarker detection lag', status: 'untested', experiment_ids: [] }]);
    await refreshGoalPapers(true);
    const evidence = await hypothesisPaperEvidence('h1');
    expect(Array.isArray(evidence)).toBe(true);
  });
});
