# Skills to Add â€” 50 Notable Skills Not Currently in the Catalog

Compiled from `agents/skills/` (unused folders) + `agents/optional-skills/` (13
categories). **None of these are wired into the registry yet** (catalog currently
has 65). Flagged by mission fit for the 90-day plan.

---

## A. Mission-relevant (wire first â€” feed the 4 revenue engines)

| # | Skill | Source | What it does | Mission fit |
|---|---|---|---|---|
| 1 | agentmail | optional/email | Agent-managed email (send/receive/threads) | E2 B2B comms |
| 2 | telephony | optional/productivity | Phone/voice automation | E2 Aetherdesk adjacent |
| 3 | domain-intel | optional/research | OSINT/domain intelligence | E3 security service |
| 4 | one-three-one-rule | optional/communication | Structured decision/response framing | Mission-wide decisions |
| 5 | fastmcp | optional/mcp | Build/test/deploy MCP servers | Infra |
| 6 | docker-management | optional/devops | Container lifecycle ops | Infra |
| 7 | inference-sh-cli | optional/devops | Run LLM inference via CLI | Cost-efficient LLM ops |
| 8 | bioinformatics | optional/research | Genomic/bio data analysis | Overlay Health |
| 9 | neuroskill-bci | optional/health | BCI wearable/biometric integration | Overlay Health |
| 10 | solana | optional/blockchain | Solana payments/tokens | E3 payments |
| 11 | base | optional/blockchain | Base (L2) chain tooling | E3 payments |
| 12 | 1password | optional/security | Secrets management | Security hygiene |
| 13 | sherlock | optional/security | OSINT username/handle search | E3 security service |
| 14 | oss-forensics | optional/security | Open-source forensics | E3 security service |
| 15 | meme-generation | optional/creative | Meme asset generation | E2 marketing |
| 16 | blender-mcp | optional/creative | Blender 3D via MCP | E2 content |
| 17 | canvas | optional/productivity | Knowledge canvas/notes | E4 research |
| 18 | siyuan | optional/productivity | SiYuan note-taking | E4 research |
| 19 | memento-flashcards | optional/productivity | Spaced-repetition flashcards | Learning/training |
| 20 | blackbox | optional/autonomous-ai-agents | External agent CLI integration | E3 agent builds |
| 21 | openclaw-migration | optional/migration | Migrate user state/customizations | Onboarding |

## B. MLOps / training infra (notable, for a model-training arm)

| # | Skill | Source | What it does |
|---|---|---|---|
| 22 | accelerate | optional/mlops | HuggingFace Accelerate â€” distributed training |
| 23 | faiss | optional/mlops | FAISS vector index (Facebook) |
| 24 | chroma | optional/mlops | Chroma vector DB |
| 25 | pinecone | optional/mlops | Pinecone vector DB |
| 26 | qdrant | optional/mlops | Qdrant vector search |
| 27 | pytorch-lightning | optional/mlops | PyTorch Lightning framework |
| 28 | tensorrt-llm | optional/mlops | NVIDIA TensorRT-LLM inference |
| 29 | llava | optional/mlops | LLaVA vision-language |
| 30 | huggingface-tokenizers | optional/mlops | HF tokenizers |
| 31 | instructor | optional/mlops | Structured LLM outputs |
| 32 | lambda-labs | optional/mlops | Lambda GPU cloud |
| 33 | nemo-curator | optional/mlops | NVIDIA data curation |
| 34 | torchtitan | optional/mlops | Distributed LLM pretraining |
| 35 | flash-attention | optional/mlops | Attention optimization |
| 36 | saelens | optional/mlops | Sparse autoencoder training |
| 37 | simpo | optional/mlops | SimPO training |
| 38 | slime | optional/mlops | SLIME RL training |
| 39 | hermes-atropos-environments | optional/mlops | Hermes/Atropos environments |

## C. Research (remaining)

| # | Skill | Source | What it does |
|---|---|---|---|
| 40 | parallel-cli | optional/research | Parallel CLI runs |
| 41 | qmd | optional/research | Quarto markdown research docs |
| 42 | duckduckgo-search | optional/research | DDG search skill |

## D. Personal / lifestyle (agents/skills unused â€” notable but not mission-critical)

| # | Skill | Source | What it does |
|---|---|---|---|
| 43 | gift-evaluator | agents/skills | Photo â†’ gift value/authenticity + social response (Spring Festival) |
| 44 | mindfulness-meditation | agents/skills | Guided meditation + streaks + reminders |
| 45 | dream-interpreter | agents/skills | AI dream interpretation (JSON output) |
| 46 | get-fortune-analysis | agents/skills | Fortune/luck analysis (Chinese cultural) |
| 47 | auto-target-tracker | agents/skills | VLM-based target tracking |
| 48 | web-shader-extractor | agents/skills | Extract shaders from web pages |
| 49 | skill-finder-cn | agents/skills | Chinese skill finder |

## E. Wildcard â€” a 50th pick

| # | Skill | Source | What it does |
|---|---|---|---|
| 50 | domain-intel â†’ **blackbox** expansion | optional/autonomous-ai-agents | Wrap external coding agents (Codex/OpenCode) into the fleet as subprocess tools |

---

## Suggested wiring order

1. **Mission-critical (A, #1â€“21):** register into the catalog + assign to the E2/E3 agents (Observer, Aetherdesk, Auditor, depscan, AgentBrowser).
2. **Research (C):** cheap to add â€” feed OmniResearch + open-notebook.
3. **MLOps (B):** register as infra skills; only wire to agents when a training arm exists.
4. **Personal (D):** keep as optional/available; not wired to mission agents.

---

## Round 2 — more skill sources reviewed

### Superpowers (agents/skills/superpowers-main — 14 skills)
Notable beyond the collection (only 'superpowers' collection slug is catalogued):
- **test-driven-development**, **systematic-debugging**, **verification-before-completion**, **requesting-code-review**, **subagent-driven-development**, **brainstorming**, **writing-skills**, **using-git-worktrees**, **dispatching-parallel-agents**, **executing-plans**
- These are engineering-workflow skills — wire to the coding agents (dca-brain, megacode, uplift-agent) + GSD.

### everything-claude-code (agents/everything-claude-code-main — 116 skills) — the biggest source
Most notable, grouped:

**Dev / platform:** backend-patterns, frontend-patterns, api-design, coding-standards, docker-patterns, deployment-patterns, database-migrations, e2e-testing, security-review, postgres-patterns, python-patterns+testing, golang-patterns+testing, rust-patterns+testing, java-coding-standards, springboot-patterns+security, laravel-patterns, django-patterns, nextjs-turbopack, mcp-server-patterns, claude-api

**Business/domain (feeds E2-E4):** market-research, deep-research, data-scraper-agent, investor-materials, investor-outreach, energy-procurement, carrier-relationship-management, inventory-demand-planning, logistics-exception-management, production-scheduling, quality-nonconformance, customs-trade-compliance, returns-reverse-logistics, x-api, crosspost, content-engine, article-writing, fal-ai-media, videodb, video-editing, nutrient-document-processing, frontend-slides

**AI/agents (fleet ops):** agentic-engineering, ai-first-engineering, autonomous-loops, continuous-agent-loop, continuous-learning, eval-harness, ralphinho-rfc-pipeline, claude-devfleet, codebase-onboarding, context-budget, cost-aware-llm-pipeline, prompt-optimizer, security-scan, verification-loop, blueprint, enterprise-agent-ops, team-builder

### OpenClaw (agents/skills/awesome-openclaw-skills-main — index of 5,490+)
Local copy is an index (categories only). Notable categories worth pulling from when needed:
web-qa-bot (already used for Auditor inspiration), social posting, browser automation, MCP servers. Pull specific skills on demand — do not bulk-vendor 5,490.

---

## Suggested wiring for Round 2 (highest value first)
1. **everything-claude-code** ? register as a **'ecc' collection** skill (one entry, path agents/everything-claude-code-main) so all 116 are discoverable; wire individual entries as needed to agents (api-design?strategist, security-review?guardian, market-research?omniresearch, e2e-testing?agent-browser).
2. **Superpowers** ? wire the 8 workflow skills to the coding agents.
3. **OpenClaw** ? pull on demand.
