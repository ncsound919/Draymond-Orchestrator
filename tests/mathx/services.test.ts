import { describe, expect, it, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callLLM: vi.fn(),
  hasKey: vi.fn(() => true),
}));

vi.mock('@/lib/draymond/llm', () => ({
  callLLM: mocks.callLLM,
  hasKey: mocks.hasKey,
}));

import {
  planMath,
  verifyDerivation,
  mergeVerifyResults,
  runHypothesis,
  exportContent,
  extractLatex,
  searchLiterature,
} from '@/lib/mathx/services';

describe('planMath', () => {
  beforeEach(() => {
    mocks.callLLM.mockReset();
  });

  it('parses the LLM plan JSON', async () => {
    mocks.callLLM.mockResolvedValue(
      JSON.stringify({ engine: 'bayesian', requires_code: true, complexity: 'high', chain: ['codegen', 'reason'] }),
    );
    const plan = await planMath('estimate a posterior', 'probability');
    expect(plan.engine).toBe('bayesian');
    expect(plan.requires_code).toBe(true);
    expect(plan.chain).toContain('codegen');
  });

  it('falls back to DEFAULT_PLAN when the LLM fails', async () => {
    mocks.callLLM.mockRejectedValue(new Error('provider down'));
    const plan = await planMath('hi', 'scientist');
    expect(plan.engine).toBe('reason');
    expect(plan.chain).toEqual(['reason']);
  });

  it('falls back to DEFAULT_PLAN on unparseable output', async () => {
    mocks.callLLM.mockResolvedValue('not json at all');
    const plan = await planMath('hi');
    expect(plan.engine).toBe('reason');
  });
});

describe('verifyDerivation', () => {
  beforeEach(() => {
    mocks.callLLM.mockReset();
  });

  it('extracts steps and generates sympy code', async () => {
    mocks.callLLM.mockResolvedValue(
      JSON.stringify([
        { step: 1, description: 'expand', from_expr: '(x+1)^2', to_expr: 'x^2+2*x+1', operation: 'expand', verifiable: true },
        { step: 2, description: 'definition', from_expr: '', to_expr: '', operation: 'definition', verifiable: false },
      ]),
    );
    const result = await verifyDerivation('(x+1)^2 = x^2+2x+1');
    expect(result.numTotal).toBe(2);
    expect(result.numVerifiable).toBe(1);
    expect(result.sympyCode).toContain('sympify("(x+1)^2"');
    expect(result.sympyCode).toContain('"step": 1');
  });

  it('returns empty results on parse failure', async () => {
    mocks.callLLM.mockResolvedValue('garbage');
    const result = await verifyDerivation('x = x');
    expect(result.numTotal).toBe(0);
    expect(result.sympyCode).toContain('"results": []');
  });
});

describe('mergeVerifyResults', () => {
  it('computes the trust score', () => {
    const steps = [
      { step: 1, description: 'a', from_expr: 'x', to_expr: 'y', operation: 'algebra', verifiable: true },
      { step: 2, description: 'b', from_expr: 'a', to_expr: 'b', operation: 'algebra', verifiable: true },
      { step: 3, description: 'c', from_expr: '', to_expr: '', operation: 'definition', verifiable: false },
    ];
    const { summary } = mergeVerifyResults(steps, [
      { step: 1, verified: true, method: 'sympy_algebraic' },
      { step: 2, verified: false, method: 'sympy_algebraic' },
    ]);
    expect(summary.verified).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.not_verifiable).toBe(1);
    expect(summary.trust_score).toBe(50);
  });
});

describe('runHypothesis', () => {
  it('falls back on unparseable output', async () => {
    mocks.callLLM.mockReset();
    mocks.callLLM.mockResolvedValue('not json');
    const result = await runHypothesis('n > n+1');
    expect(result.conjecture).toBe('n > n+1');
    expect(String(result.testCode)).toContain('inconclusive');
  });
});

describe('exportContent', () => {
  it('produces the right content type and filename', async () => {
    mocks.callLLM.mockReset();
    mocks.callLLM.mockResolvedValue('\\documentclass{article}');
    const result = await exportContent('some math', 'latex', 'My Math Notes');
    expect(result.contentType).toBe('application/x-latex');
    expect(result.filename).toBe('my-math-notes.tex');
    expect(result.body).toBe('\\documentclass{article}');
  });

  it('sanitizes filenames against header injection', async () => {
    mocks.callLLM.mockReset();
    mocks.callLLM.mockResolvedValue('# doc');
    const result = await exportContent('x', 'markdown', 'note"; drop table -- 🎉');
    expect(result.filename).toMatch(/^[a-z0-9._-]+\.md$/);
    expect(result.filename).not.toMatch(/[";`\n\r]/);
  });
});

describe('extractLatex', () => {
  it('rejects unsupported media types before calling the LLM', async () => {
    mocks.callLLM.mockReset();
    await expect(extractLatex('aGk=', 'image/bmp')).rejects.toThrow(/Unsupported media type/);
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });

  it('calls the vision path for a supported type', async () => {
    mocks.callLLM.mockReset();
    mocks.callLLM.mockResolvedValue('$x^2$');
    const result = await extractLatex('aGk=', 'image/png');
    expect(result.latex).toBe('$x^2$');
    expect(mocks.callLLM).toHaveBeenCalledWith(expect.objectContaining({ images: [{ dataB64: 'aGk=', mediaType: 'image/png' }] }));
  });

  it('fails fast when no vision-capable provider is configured', async () => {
    mocks.callLLM.mockReset();
    mocks.hasKey.mockReturnValue(false);
    await expect(extractLatex('aGk=', 'image/png')).rejects.toThrow(/vision-capable provider/);
    expect(mocks.callLLM).not.toHaveBeenCalled();
    mocks.hasKey.mockReturnValue(true);
  });
});

describe('searchLiterature (XML parsing, mocked fetch)', () => {
  const pubmedXml =
    '<PubmedArticleSet><PubmedArticle><MedlineCitation>' +
    '<Article><ArticleTitle>Prime gaps</ArticleTitle><Abstract>' +
    '<AbstractText>We study prime gaps.</AbstractText></Abstract>' +
    '<AuthorList><Author><LastName>Zhang</LastName></Author></AuthorList>' +
    '<Journal><Title>Math Ann</Title></Journal>' +
    '<PubDate><Year>2013</Year></PubDate></Article></MedlineCitation></PubmedArticle>' +
    '</PubmedArticleSet>';

  const arxivXml =
    '<feed><entry><title>On the spectrum</title><summary>We compute spectra.</summary>' +
    '<name>Alice</name><name>Bob</name>' +
    '<published>2020-05-01</published><id>https://arxiv.org/abs/2005.00001</id>' +
    '</entry></feed>';

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('esearch.fcgi')) {
          return Promise.resolve(new Response(JSON.stringify({ esearchresult: { idlist: ['12345'] } }), { status: 200 }));
        }
        if (url.includes('efetch.fcgi')) {
          return Promise.resolve(new Response(pubmedXml, { status: 200 }));
        }
        if (url.includes('arxiv.org')) {
          return Promise.resolve(new Response(arxivXml, { status: 200 }));
        }
        return Promise.resolve(new Response('', { status: 404 }));
      }),
    );
  });

  it('parses PubMed and arXiv results', async () => {
    const result = await searchLiterature('prime gaps', ['pubmed', 'arxiv'], 3);
    expect(result.errors).toEqual([]);
    const pubmed = result.results.find((r) => r.source === 'pubmed');
    const arxiv = result.results.find((r) => r.source === 'arxiv');
    expect(pubmed?.title).toBe('Prime gaps');
    expect(pubmed?.year).toBe('2013');
    expect(pubmed?.url).toContain('12345');
    expect(arxiv?.title).toBe('On the spectrum');
    expect(arxiv?.year).toBe('2020');
    expect(arxiv?.id).toBe('arxiv-2005.00001');
  });

  it('captures per-source errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 500 }))),
    );
    const result = await searchLiterature('x', ['pubmed', 'arxiv'], 2);
    expect(result.results).toEqual([]);
    expect(result.errors.length).toBe(2);
  });
});
