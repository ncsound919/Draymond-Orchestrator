// ============================================================================
// DRAYMOND MATHX — service layer (ported from @mathx/api routes)
// ============================================================================
// All Math X API business logic, embedded. Routes under src/app/api/math/* are
// thin handlers over these functions so the logic is unit-testable with callLLM
// mocked. Every LLM call goes through Draymond's callLLM (budget + fallback
// chain + mode-aware token limits) — never a fresh SDK client.
//
// Known math-x bugs fixed on port:
//   1. OCR uses the canonical { data, mediaType } contract (web sent `image`).
//   2. Literature search lives at /api/math/literature/search (not /literature).
//   3. Export supports markdown | latex | jupyter | plain only (no phantom DOCX).
//   4. Errors are sanitized — never leaked to the client.
// ============================================================================

import { callLLM, hasKey } from '../draymond/llm';
import type { LLMProvider } from '../draymond/llm';
import { preferredProviderForMode, maxTokensForMode } from './router';
import { buildSymPyVerificationCode, computeSummary } from './verify';
import {
  MATHX_SYSTEM,
  DOMAIN_SYSTEM_PROMPTS,
  PROOF_ASSISTANT_PROMPT,
  MODE_PREFIXES,
  buildRetrievedContextBlock,
  buildExecutionBlock,
} from './index';
import type { ExecutionPlan } from './types';

// ── LLM dispatch helper ─────────────────────────────────────────────────────

interface MathxLlmOptions {
  mode: string;
  system: string;
  userMessage: string;
  maxTokens?: number;
  images?: Array<{ dataB64: string; mediaType: string }>;
  /** Truncate the input to fit the token budget (safety net for huge context). */
  truncate?: boolean;
  /** Registry key for a deterministic fallback (see ../draymond/fallbacks). */
  fallbackKey?: string;
}

async function mathxLlm(opts: MathxLlmOptions): Promise<string> {
  const provider = preferredProviderForMode(opts.mode, (p) => hasKey(p as LLMProvider));
  return callLLM({
    provider,
    mode: opts.mode,
    system: opts.system,
    userMessage: opts.userMessage,
    maxTokens: opts.maxTokens,
    images: opts.images,
    truncate: opts.truncate,
    temperature: 0.2,
    fallbackKey: opts.fallbackKey,
  });
}

/** Best-effort JSON parse of an LLM response; returns fallback on failure. */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Chat (Math X narrative answer — non-streaming) ─────────────────────────

export interface MathChatInput {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  mode?: string;
  domain?: string;
  retrieved?: Array<{ source: string; text: string; score: number }>;
  execution?: { stdout?: string; error?: string };
}

/** Port of math-x /api/chat prompt assembly, request/response (no SSE). */
export async function mathChat(input: MathChatInput): Promise<{ text: string }> {
  const mode = input.mode ?? 'scientist';
  const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
  const prefixKey = input.domain && MODE_PREFIXES[input.domain] ? input.domain : mode;
  const prefix = MODE_PREFIXES[prefixKey] ?? MODE_PREFIXES.scientist;

  const history = input.messages
    .slice(0, -1)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const userMessage = [
    history ? `## Conversation so far\n${history}` : null,
    buildRetrievedContextBlock(input.retrieved ?? []),
    buildExecutionBlock(input.execution),
    `${prefix}${lastUser?.content ?? ''}`,
  ]
    .filter(Boolean)
    .join('\n');

  const text = await mathxLlm({
    mode,
    system: MATHX_SYSTEM,
    userMessage,
    maxTokens: maxTokensForMode(mode),
    truncate: true,
    fallbackKey: 'mathx.mathChat',
  });
  return { text };
}

// ── Plan ────────────────────────────────────────────────────────────────────
const PLANNER_SYSTEM = `You are a query planner for a mathematical intelligence system. Given a user query, return a JSON plan.

Respond with ONLY valid JSON, no markdown, no explanation.

Schema:
{
  "engine": "symbolic" | "montecarlo" | "bayesian" | "dataset" | "plot" | "compute" | "document" | "reason",
  "requires_code": boolean,
  "requires_chart": boolean,
  "requires_retrieval": boolean,
  "domain": string,
  "complexity": "low" | "medium" | "high",
  "summary": string,
  "chain": string[]
}`;

const DEFAULT_PLAN: ExecutionPlan = {
  engine: 'reason',
  requires_code: false,
  requires_chart: false,
  requires_retrieval: false,
  domain: 'general',
  complexity: 'medium',
  summary: 'Direct reasoning',
  chain: ['reason'],
};

export async function planMath(
  query: string,
  mode = 'scientist',
  domain?: string,
  hasFiles = false,
): Promise<ExecutionPlan> {
  try {
    const domainCtx = domain ? `\nActive domain: ${domain}` : '';
    const raw = await mathxLlm({
      mode,
      system: PLANNER_SYSTEM,
      userMessage: `Mode: ${mode}${domainCtx}\nHas uploaded files: ${hasFiles}\nQuery: ${query}`,
      maxTokens: 300,
      fallbackKey: 'mathx.planMath',
    });
    return { ...DEFAULT_PLAN, ...parseJson<Partial<ExecutionPlan>>(raw, {}) };
  } catch {
    return DEFAULT_PLAN;
  }
}

// ── Codegen ─────────────────────────────────────────────────────────────────

const CODEGEN_SYSTEM = `You are a Python code generator for mathematical and scientific computation.

Your code MUST end with a single print(json.dumps({...})) call using this EXACT output schema:

{
  "stdout": "<any human-readable summary>",
  "chart": {
    "type": "line|scatter|surface|heatmap|histogram|pie|violin|bar",
    "data": [ /* Plotly trace objects */ ],
    "layout": { "title": "...", "xaxis": {}, "yaxis": {} }
  },
  "table": {
    "columns": ["col1", "col2"],
    "rows": [[val1, val2], ...]
  }
}

"chart" and "table" are optional — include only when relevant.
Always import json at the top. Use numpy, scipy, sympy as needed.
For charts: build data as plain Python dicts (not Plotly Figure objects).

Example for a sine plot:
  import json, numpy as np
  x = np.linspace(0, 2*np.pi, 200).tolist()
  y = np.sin(x).tolist()
  print(json.dumps({
    "stdout": "Plotted sin(x) over [0, 2π]",
    "chart": {
      "type": "line",
      "data": [{"x": x, "y": y, "mode": "lines", "name": "sin(x)"}],
      "layout": {"title": "sin(x)"}
    }
  }))

Named scalar constants should be top-level assignments on their own lines:
  omega = 2.5
  n = 100
This enables the parameter slider UI to detect and expose them.`;

export async function generateMathCode(
  task: string,
  mode: string,
  context?: string,
  domain?: string,
): Promise<string> {
  const domainCtx = domain ? `\nActive domain: ${domain}` : '';
  const contextBlock = context?.trim()
    ? `\n\nRelevant context:\n${context.slice(0, 1500)}`
    : '';
  const code = await mathxLlm({
    mode,
    system: CODEGEN_SYSTEM,
    userMessage: `Mode: ${mode}${domainCtx}\nTask: ${task}${contextBlock}\n\nGenerate Python code now. Output ONLY the code — no markdown fences, no explanation.`,
    maxTokens: 2048,
    fallbackKey: 'mathx.generateMathCode',
  });
  return code.trim();
}

// ── Verify (derivation extraction + SymPy codegen) ─────────────────────────

const STEP_EXTRACTION_SYSTEM = `You are a mathematical derivation formatter.
Given any mathematical derivation or proof, extract each step as a structured JSON array.

Output ONLY a valid JSON array, no markdown, no explanation.

Each element must have:
- "step": integer (1-based)
- "description": string (human-readable description of what happened)
- "from_expr": string (the expression BEFORE this transformation, as a SymPy-parseable Python string)
- "to_expr": string (the expression AFTER this transformation, as a SymPy-parseable Python string)
- "operation": string (e.g. "expand", "factor", "substitute", "simplify", "differentiate", "integrate", "rearrange", "definition")
- "verifiable": boolean (false if step is a definition, assumption, theorem citation, or inherently non-algebraic)

Rules for SymPy-parseable expressions:
- Use ** for powers (not ^)
- Use sympy function names: sin, cos, exp, log, sqrt, Rational, pi, E
- Variables must be simple: x, y, z, n, t, a, b, c
- Do NOT include equals signs — from_expr and to_expr are separate sides
- If an expression cannot be represented in SymPy, set verifiable: false`;

export interface ExtractedDerivation {
  steps: Array<{
    step: number;
    description: string;
    from_expr: string;
    to_expr: string;
    operation: string;
    verifiable: boolean;
  }>;
  sympyCode: string;
  numVerifiable: number;
  numTotal: number;
}

export async function verifyDerivation(
  expression: string,
  mode = 'algebraic',
  domain?: string,
): Promise<ExtractedDerivation> {
  const raw = await mathxLlm({
    mode: 'deep-solve',
    system: STEP_EXTRACTION_SYSTEM,
    userMessage: `Mode: ${mode}${domain ? ` Domain: ${domain}` : ''}\n\nDerivation to extract:\n${expression}`,
    maxTokens: 2000,
    fallbackKey: 'mathx.verifyDerivation',
  });
  const steps = parseJson<Array<{ step: number; description: string; from_expr: string; to_expr: string; operation: string; verifiable: boolean }>>(raw, []);
  const verifiable = steps.filter((s) => s.verifiable && s.from_expr && s.to_expr);
  return {
    steps,
    sympyCode: buildSymPyVerificationCode(steps),
    numVerifiable: verifiable.length,
    numTotal: steps.length,
  };
}

export function mergeVerifyResults(
  steps: ExtractedDerivation['steps'],
  sympyResults: Array<{ step: number; verified: boolean; method: string; error?: string }>,
): {
  steps: Array<ExtractedDerivation['steps'][number] & { verification: { verified: boolean | null; method: string; error?: string } }>;
  summary: { total: number; verified: number; failed: number; not_verifiable: number; trust_score: number };
} {
  const resultMap = new Map(sympyResults.map((r) => [r.step, r]));
  const annotated = steps.map((s) => ({
    ...s,
    verification: s.verifiable
      ? (resultMap.get(s.step) || { verified: false, method: 'not_run' })
      : { verified: null, method: 'not_verifiable' },
  }));
  return { steps: annotated, summary: computeSummary(annotated) };
}

// ── Hypothesis ──────────────────────────────────────────────────────────────

const HYPOTHESIS_SYSTEM = `You are a mathematical hypothesis engine. Given a mathematical statement or
observation, generate a precisely stated, falsifiable conjecture and a Python
test that checks it numerically.

Respond ONLY with valid JSON matching this schema (no markdown, no explanation):
{
  "conjecture": "Precise mathematical statement of the hypothesis",
  "nullHypothesis": "What would be true if the conjecture is false",
  "falsifiability": "How to numerically or algebraically test this",
  "testCode": "Complete Python code using numpy/sympy that tests the conjecture. MUST print a JSON object: {\\"result\\": \\"supported\\"|\\"refuted\\"|\\"inconclusive\\", \\"evidence\\": \"...\", \\"pValue\\": null|float, \\"symbolicProof\\": \"...\"}",
  "domain": "mathematical domain",
  "confidence": "low|medium|high"
}`;

const REFINEMENT_SYSTEM = `You are a mathematical hypothesis refinement engine.
Given a conjecture and its test result, either:
1. Confirm the conjecture with a brief proof sketch
2. Propose a refined, narrower conjecture that is consistent with the evidence
3. Explain why the conjecture is false and suggest an alternative

Respond in clear mathematical prose (not JSON). Include LaTeX where appropriate.`;

export async function runHypothesis(
  statement: string,
  mode?: string,
  context?: string,
): Promise<Record<string, unknown>> {
  const prompt = context
    ? `Domain context:\n${context}\n\nStatement to investigate: ${statement}`
    : `Statement to investigate: ${statement}`;
  const raw = await mathxLlm({
    mode: mode ?? 'hypothesis',
    system: HYPOTHESIS_SYSTEM,
    userMessage: prompt,
    maxTokens: 2000,
    fallbackKey: 'mathx.runHypothesis',
  });
  return parseJson<Record<string, unknown>>(raw, {
    conjecture: statement,
    testCode:
      'import json\nprint(json.dumps({"result": "inconclusive", "evidence": "Parse error", "pValue": null, "symbolicProof": ""}))',
    falsifiability: '',
    nullHypothesis: '',
  });
}

/** Refinement is non-streaming in Draymond (callLLM is request/response). */
export async function refineHypothesis(
  conjecture: string,
  testResult: string,
  verdict: string,
): Promise<{ text: string }> {
  const text = await mathxLlm({
    mode: 'hypothesis',
    system: REFINEMENT_SYSTEM,
    userMessage: `Conjecture: ${conjecture}\n\nNumerical test result: ${testResult}\n\nVerdict: ${verdict}\n\nPlease refine or confirm this hypothesis.`,
    maxTokens: 1500,
    fallbackKey: 'mathx.refineHypothesis',
  });
  return { text };
}

// ── Analogies ───────────────────────────────────────────────────────────────

const ANALOGIES_SYSTEM = `You are a cross-domain mathematical analogy engine. Given a mathematical equation
or concept, identify 3–5 structurally isomorphic equations from different scientific domains.

For each analogy, explain:
1. The domain and physical/mathematical context
2. The corresponding variables (explicit mapping table)
3. What mathematical structure they share (the "skeleton")
4. Why this analogy is non-trivial or surprising
5. One concrete insight that transfers across domains

Respond ONLY with valid JSON (no markdown):
{
  "inputConcept": "...",
  "sharedStructure": "Description of the underlying mathematical skeleton",
  "analogies": [
    {
      "domain": "Physics / Biology / ...",
      "equation": "LaTeX equation string",
      "variables": { "original_var": "analogous_var" },
      "explanation": "...",
      "insight": "...",
      "nonTriviality": "low|medium|high"
    }
  ]
}`;

export async function runAnalogies(
  concept: string,
  domain?: string,
  maxAnalogies = 4,
): Promise<Record<string, unknown>> {
  const prompt = domain
    ? `Source domain: ${domain}\n\nEquation/concept: ${concept}\n\nFind ${maxAnalogies} cross-domain structural analogies.`
    : `Equation/concept: ${concept}\n\nFind ${maxAnalogies} cross-domain structural analogies.`;
  const raw = await mathxLlm({
    mode: 'synergy',
    system: ANALOGIES_SYSTEM,
    userMessage: prompt,
    maxTokens: 3000,
    fallbackKey: 'mathx.runAnalogies',
  });
  return parseJson<Record<string, unknown>>(raw, {
    inputConcept: concept,
    sharedStructure: '',
    analogies: [],
  });
}

// ── Domain expert ───────────────────────────────────────────────────────────

export async function runDomainExpert(
  domain: string,
  query: string,
  isProofRequest = false,
): Promise<{ text: string }> {
  const domainPrompt = DOMAIN_SYSTEM_PROMPTS[domain] || '';
  const systemBase = isProofRequest ? PROOF_ASSISTANT_PROMPT : domainPrompt;
  const text = await mathxLlm({
    mode: 'domain',
    system: `${MATHX_SYSTEM}\n\n${systemBase}`,
    userMessage: query,
    maxTokens: 4096,
    fallbackKey: 'mathx.runDomainExpert',
  });
  return { text };
}

// ── Export ──────────────────────────────────────────────────────────────────

const FORMAT_SYSTEM: Record<string, string> = {
  latex: `You are a LaTeX formatter. Convert the provided mathematical content into a clean, compilable LaTeX document.
Use \\begin{document}...\\end{document}. Use appropriate math environments: equation, align, cases.
Include \\usepackage{amsmath,amssymb,amsthm}. Output ONLY the LaTeX, no explanation.`,
  jupyter: `You are a Jupyter Notebook formatter. Convert the provided content into a valid .ipynb JSON structure.
Split narrative text into Markdown cells and any code into Python code cells.
Output ONLY valid JSON conforming to the nbformat 4.5 spec, no explanation.`,
  markdown: `You are a Markdown formatter. Convert the provided mathematical content into clean GitHub-flavored Markdown.
Use $ and $$ for inline/block math. Use headers, bold, and code blocks appropriately.
Output ONLY the Markdown, no explanation.`,
  plain: `You are a plain text formatter. Convert the provided content into readable plain text with ASCII math notation.
Output ONLY the plain text, no explanation.`,
};

export type ExportFormat = 'markdown' | 'latex' | 'jupyter' | 'plain';

export interface ExportResult {
  body: string;
  contentType: string;
  filename: string;
}

const EXPORT_META: Record<ExportFormat, { contentType: string; ext: string }> = {
  latex: { contentType: 'application/x-latex', ext: '.tex' },
  jupyter: { contentType: 'application/json', ext: '.ipynb' },
  markdown: { contentType: 'text/markdown', ext: '.md' },
  plain: { contentType: 'text/plain', ext: '.txt' },
};

export async function exportContent(
  content: string,
  format: ExportFormat = 'markdown',
  title?: string,
  mode?: string,
): Promise<ExportResult> {
  const userMessage = [
    title ? `Title: ${title}` : null,
    mode ? `Mode: ${mode}` : null,
    `\nContent to export:\n${content}`,
  ]
    .filter(Boolean)
    .join('\n');

  const body = await mathxLlm({
    mode: mode ?? 'scientist',
    system: FORMAT_SYSTEM[format] ?? FORMAT_SYSTEM.plain,
    userMessage,
    maxTokens: 4000,
    fallbackKey: 'mathx.exportContent',
  });

  const meta = EXPORT_META[format];
  // Sanitize the filename for Content-Disposition — a crafted title must not
  // smuggle header delimiters (CR/LF, quotes, semicolons) into the response.
  const safeTitle = (title || 'mathx-export')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80);
  const filename = `${safeTitle.toLowerCase() || 'mathx-export'}${meta.ext}`;
  return { body, contentType: meta.contentType, filename };
}

// ── OCR (vision) ────────────────────────────────────────────────────────────

const OCR_SYSTEM = `You are a mathematical OCR engine. Given an image containing mathematical notation,
extract ALL mathematical content and return it as clean LaTeX.

Rules:
- Use $...$ for inline math and $$....$$ for display blocks.
- Preserve the original structure (equations, matrices, fractions, integrals).
- If the image contains text + math, include both, wrapping only the math in LaTeX delimiters.
- Do NOT wrap your response in markdown code fences.
- If the image contains no math, return the plain text as-is.
- Prefer \\frac, \\sum, \\int, \\partial, \\nabla over verbose alternatives.`;

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export async function extractLatex(
  data: string,
  mediaType: string,
): Promise<{ latex: string }> {
  if (!SUPPORTED_IMAGE_TYPES.includes(mediaType as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
    throw new Error(`Unsupported media type "${mediaType}" — use image/jpeg, image/png, image/gif, or image/webp`);
  }
  if (!hasKey('anthropic') && !hasKey('gemini') && !hasKey('openai')) {
    throw new Error('OCR requires a vision-capable provider (ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY)');
  }
  const latex = await mathxLlm({
    mode: 'scientist',
    system: OCR_SYSTEM,
    userMessage: 'Extract all mathematical content from this image as LaTeX.',
    maxTokens: 1500,
    images: [{ dataB64: data, mediaType }],
    fallbackKey: 'mathx.extractLatex',
  });
  return { latex: latex.trim() };
}

// ── Literature (pure fetch — no LLM) ────────────────────────────────────────

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const ARXIV_BASE = 'https://export.arxiv.org/api/query';
const TOOL_NAME = 'draymond-mathx';
const TOOL_EMAIL = process.env.NCBI_EMAIL || 'mathx@ncsound919.dev';

export interface PaperResult {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  year: string;
  journal: string;
  url: string;
  source: 'pubmed' | 'arxiv';
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

function ncbiApiKeyParam(): string {
  return process.env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(process.env.NCBI_API_KEY)}` : '';
}

function parsePubMedXML(xml: string, ids: string[]): PaperResult[] {
  const articles: PaperResult[] = [];
  // NOTE: no dotAll (`s`) flag — target is ES2017, so use [\s\S] for any-char.
  const articleBlocks = xml.match(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g) || [];

  for (let i = 0; i < articleBlocks.length; i++) {
    const block = articleBlocks[i];
    const strip = (s: string) => s.replace(/<[^>]+>/g, '').trim();
    const titleMatch = block.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/);
    const title = titleMatch ? strip(titleMatch[1]) : 'Untitled';
    const abstractParts = block.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [];
    const abstract = abstractParts.map((p) => strip(p)).join(' ');
    const authorMatches = block.match(/<LastName>([\s\S]*?)<\/LastName>/g) || [];
    const authors = authorMatches.slice(0, 4).map((m) => strip(m));
    const yearMatch = block.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
    const year = yearMatch ? yearMatch[1] : 'Unknown';
    const journalMatch = block.match(/<Title>([\s\S]*?)<\/Title>/);
    const journal = journalMatch ? strip(journalMatch[1]) : '';
    const pmid = ids[i] || '';
    articles.push({
      id: `pmid-${pmid}`,
      title,
      authors,
      abstract: abstract.slice(0, 1500),
      year,
      journal,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      source: 'pubmed',
    });
  }
  return articles;
}

function parseArXivXML(xml: string): PaperResult[] {
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  return entries.map((entry) => {
    const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? strip(titleMatch[1]) : 'Untitled';
    const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
    const abstract = summaryMatch ? strip(summaryMatch[1]).slice(0, 1500) : '';
    const authorMatches = entry.match(/<name>([\s\S]*?)<\/name>/g) || [];
    const authors = authorMatches.slice(0, 4).map((m) => m.replace(/<[^>]+>/g, '').trim());
    const publishedMatch = entry.match(/<published>(\d{4})/);
    const year = publishedMatch ? publishedMatch[1] : 'Unknown';
    const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
    const arxivId = idMatch ? idMatch[1].trim() : '';
    const shortId = arxivId.replace('http://arxiv.org/abs/', '').replace('https://arxiv.org/abs/', '');
    return {
      id: `arxiv-${shortId}`,
      title,
      authors,
      abstract,
      year,
      journal: 'arXiv',
      url: `https://arxiv.org/abs/${shortId}`,
      source: 'arxiv' as const,
    };
  });
}

export async function searchLiterature(
  query: string,
  sources: Array<'pubmed' | 'arxiv'> = ['pubmed', 'arxiv'],
  maxPerSource = 4,
): Promise<{ results: PaperResult[]; errors: string[]; query: string }> {
  const results: PaperResult[] = [];
  const errors: string[] = [];

  const run = async (fn: () => Promise<PaperResult[]>, label: string) => {
    try {
      results.push(...(await fn()));
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await Promise.all([
    sources.includes('pubmed') ? run(async () => {
      const apiKey = ncbiApiKeyParam();
      const searchUrl = `${NCBI_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxPerSource}&retmode=json&tool=${TOOL_NAME}&email=${TOOL_EMAIL}${apiKey}`;
      const searchRes = await fetchWithTimeout(searchUrl);
      if (!searchRes.ok) throw new Error(`PubMed ESearch failed: ${searchRes.status}`);
      const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
      const ids: string[] = searchData?.esearchresult?.idlist || [];
      if (ids.length === 0) return [];
      const fetchUrl = `${NCBI_BASE}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=abstract&retmode=xml&tool=${TOOL_NAME}&email=${TOOL_EMAIL}${apiKey}`;
      const fetchRes = await fetchWithTimeout(fetchUrl);
      if (!fetchRes.ok) throw new Error(`PubMed EFetch failed: ${fetchRes.status}`);
      return parsePubMedXML(await fetchRes.text(), ids);
    }, 'PubMed') : Promise.resolve(),
    sources.includes('arxiv') ? run(async () => {
      const url = `${ARXIV_BASE}?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxPerSource}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`arXiv search failed: ${res.status}`);
      return parseArXivXML(await res.text());
    }, 'arXiv') : Promise.resolve(),
  ]);

  return { results, errors, query };
}

export async function getPubmedPaper(pmid: string): Promise<{ paper: PaperResult | null }> {
  const apiKey = ncbiApiKeyParam();
  const url = `${NCBI_BASE}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml&tool=${TOOL_NAME}&email=${TOOL_EMAIL}${apiKey}`;
  const fetchRes = await fetchWithTimeout(url);
  const xml = await fetchRes.text();
  const parsed = parsePubMedXML(xml, [pmid]);
  return { paper: parsed[0] || null };
}

export interface GeneResult {
  id: string;
  name: string;
  description: string;
  organism: string;
  chromosome: string;
  location: string;
  summary: string;
  url: string;
}

export async function getGenes(query: string): Promise<{ genes: GeneResult[] }> {
  const apiKey = ncbiApiKeyParam();
  const searchUrl = `${NCBI_BASE}/esearch.fcgi?db=gene&term=${encodeURIComponent(`${query}[gene]`)}&retmax=5&retmode=json&tool=${TOOL_NAME}&email=${TOOL_EMAIL}${apiKey}`;
  const searchRes = await fetchWithTimeout(searchUrl);
  const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
  const ids: string[] = searchData?.esearchresult?.idlist || [];
  if (ids.length === 0) return { genes: [] };

  const summaryUrl = `${NCBI_BASE}/esummary.fcgi?db=gene&id=${ids.slice(0, 5).join(',')}&retmode=json&tool=${TOOL_NAME}&email=${TOOL_EMAIL}${apiKey}`;
  const summaryRes = await fetchWithTimeout(summaryUrl);
  const summaryData = (await summaryRes.json()) as { result?: Record<string, { name?: string; description?: string; organism?: { scientificname?: string }; chromosome?: string; maplocation?: string; summary?: string }> };

  const genes = ids
    .slice(0, 5)
    .map((id) => {
      const doc = summaryData?.result?.[id];
      if (!doc) return null;
      return {
        id,
        name: doc.name ?? '',
        description: doc.description ?? '',
        organism: doc.organism?.scientificname ?? '',
        chromosome: doc.chromosome ?? '',
        location: doc.maplocation ?? '',
        summary: (doc.summary ?? '').slice(0, 500),
        url: `https://www.ncbi.nlm.nih.gov/gene/${id}`,
      };
    })
    .filter((g): g is GeneResult => g !== null);

  return { genes };
}

// ── Bio (pure fetch — no LLM) ───────────────────────────────────────────────

export async function searchNcbi(
  query: string,
  db: 'nucleotide' | 'protein' | 'gene' | 'pubmed' = 'protein',
  retmax = 5,
): Promise<{ results: Array<Record<string, unknown>>; total: number }> {
  const apiKey = ncbiApiKeyParam();
  const searchUrl = `${NCBI_BASE}/esearch.fcgi?db=${db}&term=${encodeURIComponent(query)}&retmax=${retmax}&retmode=json${apiKey}`;
  const searchRes = await fetchWithTimeout(searchUrl);
  const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[]; count?: number } };
  const ids: string[] = searchData?.esearchresult?.idlist ?? [];
  if (ids.length === 0) return { results: [], total: 0 };

  const fetchUrl = `${NCBI_BASE}/esummary.fcgi?db=${db}&id=${ids.join(',')}&retmode=json${apiKey}`;
  const fetchRes = await fetchWithTimeout(fetchUrl);
  const fetchData = (await fetchRes.json()) as {
    result?: { uids?: string[]; [k: string]: unknown };
  };
  const uids: string[] = (fetchData?.result?.uids as string[] | undefined) ?? ids;
  const docMap = fetchData?.result as Record<string, { title?: string; caption?: string; extra?: string; status?: string; organism?: string; slen?: number; length?: number; accessionversion?: string; accession?: string }>;

  const results = uids.map((uid: string) => {
    const doc = docMap?.[uid] ?? {};
    return {
      uid,
      title: doc.title ?? doc.caption ?? '',
      description: doc.extra ?? doc.status ?? '',
      organism: doc.organism ?? '',
      length: doc.slen ?? doc.length ?? null,
      accession: doc.accessionversion ?? doc.accession ?? uid,
      db,
    };
  });

  return { results, total: searchData?.esearchresult?.count ?? results.length };
}

export async function searchUniprot(
  query: string,
  size = 5,
): Promise<{ results: Array<Record<string, unknown>>; total: number }> {
  const url =
    `https://rest.uniprot.org/uniprotkb/search` +
    `?query=${encodeURIComponent(query)}&format=json&size=${size}` +
    `&fields=accession,id,protein_name,gene_names,organism_name,length,cc_function,cc_subcellular_location`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`UniProt search failed: ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{
      primaryAccession?: string;
      uniProtkbId?: string;
      proteinDescription?: { recommendedName?: { fullName?: { value?: string } }; submittedName?: Array<{ fullName?: { value?: string } }> };
      genes?: Array<{ geneName?: { value?: string } }>;
      organism?: { scientificName?: string };
      sequence?: { length?: number };
      comments?: Array<{ commentType?: string; texts?: Array<{ value?: string }>; subcellularLocations?: Array<{ location?: { value?: string } }> }>;
    }>;
  };

  const results = (data?.results ?? []).map((r) => ({
    accession: r.primaryAccession ?? '',
    id: r.uniProtkbId ?? '',
    proteinName:
      r.proteinDescription?.recommendedName?.fullName?.value ??
      r.proteinDescription?.submittedName?.[0]?.fullName?.value ??
      '',
    geneNames: r.genes?.map((g) => g.geneName?.value).filter(Boolean) ?? [],
    organism: r.organism?.scientificName ?? '',
    length: r.sequence?.length ?? null,
    function: r.comments?.find((c) => c.commentType === 'FUNCTION')?.texts?.[0]?.value ?? '',
    subcellularLocation:
      r.comments
        ?.find((c) => c.commentType === 'SUBCELLULAR LOCATION')
        ?.subcellularLocations?.[0]?.location?.value ?? '',
    url: `https://www.uniprot.org/uniprotkb/${r.primaryAccession}`,
  }));

  return { results, total: results.length };
}

// ── Models (provider probe) ─────────────────────────────────────────────────

export async function probeMathModels(): Promise<{
  claude: boolean;
  deepseek: boolean;
  qwen: boolean;
  ollama: { available: boolean; model: string; models: string[] };
}> {
  const ollamaURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  let models: string[] = [];
  try {
    const res = await fetch(`${ollamaURL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      models = (json.models || []).map((m) => m.name);
    }
  } catch {
    models = [];
  }
  return {
    claude: hasKey('anthropic'),
    deepseek: hasKey('deepseek'),
    qwen: hasKey('qwen'),
    ollama: {
      available: models.some((m) => m.toLowerCase().includes('deepseek')),
      model: process.env.OLLAMA_MODEL || 'deepseek-r1:8b',
      models,
    },
  };
}
