# Skills to Add — 50 Notable Skills Not Currently in the Catalog

Compiled from `agents/skills/` (unused folders) + `agents/optional-skills/` (13
categories). **None of these are wired into the registry yet** (catalog currently
has 65). Flagged by mission fit for the 90-day plan.

---

## A. Mission-relevant (wire first — feed the 4 revenue engines)

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
| 22 | accelerate | optional/mlops | HuggingFace Accelerate — distributed training |
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

## D. Personal / lifestyle (agents/skills unused — notable but not mission-critical)

| # | Skill | Source | What it does |
|---|---|---|---|
| 43 | gift-evaluator | agents/skills | Photo → gift value/authenticity + social response (Spring Festival) |
| 44 | mindfulness-meditation | agents/skills | Guided meditation + streaks + reminders |
| 45 | dream-interpreter | agents/skills | AI dream interpretation (JSON output) |
| 46 | get-fortune-analysis | agents/skills | Fortune/luck analysis (Chinese cultural) |
| 47 | auto-target-tracker | agents/skills | VLM-based target tracking |
| 48 | web-shader-extractor | agents/skills | Extract shaders from web pages |
| 49 | skill-finder-cn | agents/skills | Chinese skill finder |

## E. Wildcard — a 50th pick

| # | Skill | Source | What it does |
|---|---|---|---|
| 50 | domain-intel → **blackbox** expansion | optional/autonomous-ai-agents | Wrap external coding agents (Codex/OpenCode) into the fleet as subprocess tools |

---

## Suggested wiring order

1. **Mission-critical (A, #1–21):** register into the catalog + assign to the E2/E3 agents (Observer, Aetherdesk, Auditor, depscan, AgentBrowser).
2. **Research (C):** cheap to add — feed OmniResearch + open-notebook.
3. **MLOps (B):** register as infra skills; only wire to agents when a training arm exists.
4. **Personal (D):** keep as optional/available; not wired to mission agents.
