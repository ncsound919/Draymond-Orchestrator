-- ============================================================================
-- DRAYMOND ORCHESTRATION SYSTEM — Migration 015
-- Registers the book library chain entities so the chain-builder can resolve
-- them: BookBridge (service), the book-bridge/bridge skill wrapper, the
-- book-to-skill converter, the personal book synthesis skill, and the
-- book-to-skill-chain orchestrator.
-- ============================================================================

INSERT INTO public.draymond_entities (
  slug, name, kind, description, version, tags, category, sector,
  invocation_method, invocation_config, capabilities, depends_on,
  download_path, is_integrated, risk_level_default, is_active, health_status
) VALUES
(
  'bookbridge', 'BookBridge', 'service',
  'Local book library daemon (REST :8777, MCP :8778). Hybrid FTS5 + TF-IDF search over indexed books, full-text retrieval with offline cache, reading plans, citations (APA/MLA/Chicago/BibTeX/Vancouver/IEEE), summaries, flashcards, knowledge graph, equation/figure search, and activity provenance. Auto-scans the library folders.',
  '1.0.0', ARRAY['books','library','search','citations','mcp','grounding'],
  'knowledge', 'learn',
  'http_api',
  '{"url":"http://127.0.0.1:8777","method":"POST","health_url":"http://127.0.0.1:8777/health","timeout_ms":30000,"endpoints":{"health":{"path":"/health","method":"GET"},"search":{"path":"/search","method":"POST"},"retrieve":{"path":"/retrieve","method":"POST"},"reading_plan":{"path":"/reading_plan","method":"POST"},"citation":{"path":"/citation","method":"POST"},"summarize":{"path":"/summarize","method":"POST"},"books":{"path":"/books","method":"GET"},"add":{"path":"/books/add","method":"POST"},"scan":{"path":"/scan","method":"POST"},"link_activity":{"path":"/link_activity","method":"POST"},"equations":{"path":"/equations","method":"POST"},"figures":{"path":"/figures","method":"POST"},"related":{"path":"/graph/related","method":"POST"}},"requires_env":["BOOKBRIDGE_URL"]}',
  ARRAY['book-search','book-retrieval','reading-plan','citations','summarization','flashcards','knowledge-graph','provenance'],
  ARRAY[]::text[], 'agents/BookBridge--main', true, 'low', true, 'unknown'
),
(
  'book-bridge', 'BookBridge Library Bridge', 'skill',
  'Bridge to the BookBridge daemon (:8777) — grounded hybrid search, full-text retrieval, reading plans, citations, summaries, flashcards, knowledge-graph traversal, and provenance linking over the local book library.',
  '1.0.0', ARRAY['books','library','grounding','citations','research'],
  'knowledge', 'learn',
  'http_api',
  '{"url":"http://127.0.0.1:8777","method":"POST","timeout_ms":30000,"endpoints":{"health":{"path":"/health","method":"GET"},"search":{"path":"/search","method":"POST"},"reading_plan":{"path":"/reading_plan","method":"POST"},"retrieve":{"path":"/retrieve","method":"POST"},"citation":{"path":"/citation","method":"POST"},"summarize":{"path":"/summarize","method":"POST"},"books":{"path":"/books","method":"GET"},"add":{"path":"/books/add","method":"POST"},"scan":{"path":"/scan","method":"POST"},"link_activity":{"path":"/link_activity","method":"POST"}},"requires_env":["BOOKBRIDGE_URL"]}',
  ARRAY['book-search','grounding','citations','reading-plan','retrieval','summarization','provenance'],
  ARRAY['bookbridge'], 'agents/skills/book-bridge', true, 'low', true, 'unknown'
),
(
  'book-to-skill', 'Book-to-Skill Converter', 'skill',
  'Convert books and documents (PDF, EPUB, DOCX, HTML, Markdown, TXT, RTF, MOBI/AZW) into structured agent skills — extracting named frameworks, mental models, principles, techniques, and anti-patterns instead of summaries.',
  '1.3.0', ARRAY['books','skills','conversion','frameworks','distillation'],
  'books', 'learn',
  'cli_command',
  '{"command":"python","args":["agents/skills/book-to-skill/scripts/extract.py"],"timeout_ms":600000}',
  ARRAY['book-to-skill','framework-extraction','skill-generation','document-parsing'],
  ARRAY[]::text[], 'agents/skills/book-to-skill', true, 'low', true, 'unknown'
),
(
  'book-synthesis-personal', 'Personal Book Synthesis', 'skill',
  'Transform any business or nonfiction book into a deeply personalized synthesis — every idea translated into the reader''s domain, problems, and cognitive style. Produces visually rich PDF and markdown.',
  '1.0.0', ARRAY['books','synthesis','personalization','reading'],
  'books', 'learn',
  'internal', '{}',
  ARRAY['book-synthesis','personalized-notes','visual-reports'],
  ARRAY[]::text[], 'agents/skills/book-synthesis-personal', true, 'low', true, 'unknown'
),
(
  'book-to-skill-chain', 'Book-to-Skill Chain', 'skill',
  'Orchestrator pipeline: ground with BookBridge, synthesize the book, run the book-to-skill converter, and register the generated skill in Draymond''s registry so every agent can use it. Modes: single book or whole library.',
  '1.0.0', ARRAY['books','pipeline','orchestration','skills'],
  'books', 'learn',
  'internal', '{}',
  ARRAY['book-pipeline','orchestration','skill-registration','library-distillation'],
  ARRAY['bookbridge','book-bridge','book-to-skill','book-synthesis-personal'],
  'agents/skills/book-to-skill-chain', true, 'low', true, 'unknown'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  version = EXCLUDED.version,
  tags = EXCLUDED.tags,
  category = EXCLUDED.category,
  sector = EXCLUDED.sector,
  invocation_method = EXCLUDED.invocation_method,
  invocation_config = EXCLUDED.invocation_config,
  capabilities = EXCLUDED.capabilities,
  depends_on = EXCLUDED.depends_on,
  download_path = EXCLUDED.download_path,
  is_integrated = EXCLUDED.is_integrated,
  risk_level_default = EXCLUDED.risk_level_default,
  is_active = true;
