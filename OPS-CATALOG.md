# Uplift Lab — Operational Catalog

Generated: 2026-08-10T10:40:08.343Z

## Totals

| Kind | Count |
| --- | --- |
| tool | 35 |
| service | 30 |
| skill | 28 |
| job | 24 |
| extension | 22 |
| chain | 17 |
| agent | 14 |
| mcp_server | 2 |
| **Total** | **172** |

## By Category

### schedule (24)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Agent Health Check | job | `Agent Health Check` | ✅ | */15 * * * * |
| Benchmark: Chains | job | `Benchmark: Chains` | ✅ | 0 6 * * 3 |
| Benchmark: Crons | job | `Benchmark: Crons` | ✅ | 0 6 * * 2 |
| Benchmark: Deep Score | job | `Benchmark: Deep Score` | ✅ | 0 6 * * 4 |
| Benchmark: Entities | job | `Benchmark: Entities` | ✅ | 0 6 * * 1 |
| Benchmark: Sites | job | `Benchmark: Sites` | ✅ | 0 7 * * 1 |
| Benchmark: Sync Roster | job | `Benchmark: Sync Roster` | ✅ | 0 8 * * 5 |
| Benchmark: Upgrade Review | job | `Benchmark: Upgrade Review` | ✅ | 0 7 * * 5 |
| Book-Grounded Research | job | `Book-Grounded Research` | ✅ | 0 5 * * * |
| Brain Wiki Sync | job | `Brain Wiki Sync` | ✅ | 0 3 * * * |
| Daily Finance Analysis | job | `Daily Finance Analysis` | ✅ | 30 9 * * 1-5 |
| Daily Health Digest | job | `Daily Health Digest` | ✅ | 0 20 * * * |
| Daily Marketing Run | job | `Daily Marketing Run` | ✅ | 0 10 * * * |
| Editorial Morning Push | job | `Editorial Morning Push` | ✅ | 0 7 * * * |
| Full Content Creation | job | `Full Content Creation` | ✅ | 0 14 * * 1,3,5 |
| Hemp Research & News Digest | job | `Hemp Research & News Digest` | ✅ | 0 7 * * * |
| IP Portfolio Grading | job | `IP Portfolio Grading` | ✅ | 0 9 * * 1 |
| Memory Decay Sweep | job | `Memory Decay Sweep` | ✅ | 0 * * * * |
| Morning Briefing | job | `Morning Briefing` | ✅ | 0 9 * * * |
| Music Business Automation | job | `Music Business Automation` | ✅ | 0 11 * * * |
| Research Data Feed | job | `Research Data Feed` | ✅ | 0 6 * * 3 |
| Site Health Checks | job | `Site Health Checks` | ✅ | */5 * * * * |
| Sports Betting Daily | job | `Sports Betting Daily` | ✅ | 0 12 * * * |
| Supply Chain Intelligence | job | `Supply Chain Intelligence` | ✅ | 0 8 * * 1-5 |

### research (22)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| AI-Scientist | agent | `ai-scientist` | ✅ | internal |
| AutoResearch Extension | extension | `ext-autoresearch` | ✅ | subprocess |
| Biotech IDE | service | `biotech-ide` | ✅ | internal |
| Book-to-Skill Chain | tool | `book-to-skill-chain` | ✅ | internal |
| BookBridge | service | `bookbridge` | ✅ | http_api |
| Boxing Sim | tool | `boxing-sim` | ✅ | internal |
| Codex Metrics | tool | `codex-metrics` | ✅ | internal |
| ColabFold | tool | `colabfold` | ✅ | cli_command |
| disease_research | tool | `disease-research` | ✅ | internal |
| Hemp-OS | agent | `hemp-os` | ✅ | http_api |
| Injury Risk | tool | `injury-risk` | ✅ | internal |
| Kaggle | tool | `kaggle` | ✅ | http_api |
| math-x | tool | `math-x` | ✅ | internal |
| MolecularGraph.jl | tool | `moleculargraph` | ✅ | internal |
| OmniResearch Pro | agent | `omni-research` | ✅ | http_api |
| Overlay Science | service | `overlay-science` | ✅ | internal |
| playgene | service | `playgene` | ✅ | http_api |
| Run Coach | tool | `run-coach` | ✅ | internal |
| sports_science | service | `sports-science` | ✅ | subprocess |
| Summarize Skill | skill | `skill-summarize` | ✅ | python_module |
| SynOp | service | `synop` | ✅ | internal |
| The Lab | extension | `ext-the-lab` | ✅ | http_api |

### finance (20)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Budget Integration Skill | skill | `skill-budget-integration` | ✅ | python_module |
| CIS Assistant | mcp_server | `mcp-cis-assistant` | ✅ | mcp_stdio |
| Finance Extension | extension | `ext-finance` | ✅ | python_module |
| Financial Strategy Agent | agent | `fs-agent` | ✅ | cli_command |
| Ghostfolio | tool | `ghostfolio` | ✅ | api_call |
| IP Builder Platform | service | `ip-builder-platform` | ✅ | internal |
| LLM Trading Lab | skill | `skill-llm-trading-lab` | ✅ | python_module |
| OTM Agent | agent | `otm-agent` | ✅ | http_api |
| Overlay Business Solutions | service | `overlay-business-solutions` | ✅ | internal |
| Overlay Finance | service | `overlay-finance` | ✅ | internal |
| Recursive IP Builder | service | `recursive-ip` | ✅ | http_api |
| Sports Betting Skill | skill | `skill-sports-betting` | ✅ | python_module |
| Stripe | service | `service-stripe` | ✅ | api_call |
| Super Tool | tool | `super-tool` | ✅ | cli_command |
| The Bank | extension | `ext-the-bank` | ✅ | http_api |
| The Block | service | `the-block` | ✅ | internal |
| Trading Agents Skill | skill | `skill-trading-agents` | ✅ | python_module |
| Trading Skill | skill | `skill-trading` | ✅ | python_module |
| TradingAgents | agent | `trading-agents` | ✅ | python_module |
| Wholesale Marketing Channel | service | `wholesale-marketing-channel` | ✅ | internal |

### workflow (17)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Audit Delivery | chain | `audit-delivery` | ✅ | steps:4 |
| Book-Grounded Research | chain | `book-grounded-research` | ✅ | steps:3 |
| Book-to-Skill Chain | chain | `tpl-book-to-skill-chain` | ✅ | steps:3 |
| Code Automation Pipeline | chain | `code-automation-pipeline` | ✅ | steps:3 |
| CPU RTL Generation Pipeline | chain | `cpu-rtl-generation` | ✅ | steps:4 |
| Daily Finance Analysis | chain | `daily-finance-analysis` | ✅ | steps:3 |
| Daily Marketing Run | chain | `daily-marketing-run` | ✅ | steps:4 |
| Full Content Creation | chain | `full-content-creation` | ✅ | steps:5 |
| Hemp Research & News Pipeline | chain | `hemp-research-news` | ✅ | steps:5 |
| IP Portfolio Grading & Protection | chain | `ip-portfolio-grading` | ✅ | steps:3 |
| MaaS Monthly Cycle | chain | `maas-monthly-cycle` | ✅ | steps:5 |
| Morning Briefing | chain | `morning-briefing` | ✅ | steps:4 |
| Music Business Automation | chain | `music-business-automation` | ✅ | steps:3 |
| Research Brief Delivery | chain | `research-brief-delivery` | ✅ | steps:4 |
| Research Data Pipeline | chain | `research-data-pipeline` | ✅ | steps:2 |
| Sports Betting Daily | chain | `sports-betting-daily` | ✅ | steps:3 |
| Supply Chain Intelligence | chain | `supply-chain-intelligence` | ✅ | steps:4 |

### content (17)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Book Publishing Platform | service | `book-publishing-platform` | ✅ | internal |
| Book Writing Assistant | agent | `book-writing-assistant` | ✅ | internal |
| Comic Book Builder | tool | `comic-book-builder` | ✅ | internal |
| Deterministic Engine Soundbank | tool | `det-engine-soundbank` | ✅ | internal |
| Dustcrate | tool | `dustcrate` | ✅ | internal |
| MoneyPrinterTurbo | tool | `money-printer-turbo` | ✅ | cli_command |
| Movie Scoring Software | tool | `movie-scoring` | ✅ | internal |
| NCSOUND | service | `nc-sound` | ✅ | internal |
| Overlay Content | tool | `overlay-content` | ✅ | internal |
| Overlay Music | service | `overlay-music` | ✅ | internal |
| Overlay Writing | service | `overlay-writing` | ✅ | internal |
| Sovereign Music Studio | service | `sovereign-music-studio` | ✅ | internal |
| Sovereign Music Studio | skill | `skill-sovereign-music` | ✅ | python_module |
| Spotify Player Skill | skill | `skill-spotify-player` | ✅ | python_module |
| TapSynth | tool | `tapsynth` | ✅ | internal |
| TPC Beats | tool | `tpc-beats` | ✅ | internal |
| Video Frames Skill | skill | `skill-video-frames` | ✅ | python_module |

### infrastructure (11)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Bridge Skill | skill | `skill-bridge` | ✅ | python_module |
| ClawRouter | extension | `ext-claw-router` | ✅ | http_api |
| ClawTeam | extension | `ext-claw-team` | ✅ | subprocess |
| Cyber Security | extension | `ext-cyber-security` | ✅ | subprocess |
| Draymond | agent | `draymond` | ✅ | internal |
| Draymond Supervisor | extension | `ext-draymond-supervisor` | ✅ | http_api |
| Local SQLite | service | `service-local-sqlite` | ✅ | api_call |
| Overlay Chain Extension | extension | `ext-overlay-chain` | ✅ | python_module |
| Overlay Chain Skill | skill | `skill-overlay-chain` | ✅ | python_module |
| Paperclip Extension | extension | `ext-paperclip` | ✅ | python_module |
| Vercel | service | `service-vercel` | ✅ | api_call |

### dev-tools (8)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Block 2.0 | tool | `block-2` | ✅ | manual |
| Digital Lab Skill | skill | `skill-digital-lab` | ✅ | python_module |
| Everything Claude Code | tool | `everything-claude-code` | ✅ | cli_command |
| Lil Homie | agent | `lil-homie` | ✅ | cli_command |
| opencode | agent | `opencode` | ✅ | http_api |
| OpenSandbox Skill | skill | `skill-open-sandbox` | ✅ | python_module |
| Phaselock | tool | `phaselock` | ✅ | internal |
| Skill Creator | skill | `skill-creator` | ✅ | python_module |

### engineering (8)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Codegang | tool | `codegang` | ✅ | http_api |
| Deterministic Brain | tool | `deterministic-brain` | ✅ | http_api |
| Grader | tool | `grader` | ✅ | http_api |
| Graphify | tool | `graphify` | ✅ | mcp_stdio |
| Mutly | tool | `mutly` | ✅ | http_api |
| RepoRank | tool | `reporank` | ✅ | http_api |
| Sub Team | agent | `sub-team` | ✅ | http_api |
| VibeServe | tool | `vibeserve` | ✅ | mcp_stdio |

### memory (6)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Engram Memory Extension | extension | `ext-engram` | ✅ | python_module |
| Engram Memory Skill | skill | `skill-engram` | ✅ | python_module |
| LanceDB Memory Extension | extension | `ext-memory-lancedb` | ✅ | python_module |
| Mem0 Memory Extension | extension | `ext-mem0` | ✅ | python_module |
| Mem0 Memory Skill | skill | `skill-mem0` | ✅ | python_module |
| Memory Core Extension | extension | `ext-memory-core` | ✅ | python_module |

### automation (5)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| AgentBrowser | tool | `agent-browser` | ✅ | http_api |
| Browser Extension | extension | `ext-browser` | ✅ | python_module |
| Browser Use | tool | `browser-use` | ✅ | python_module |
| Remote Control Skill | skill | `skill-remote-control` | ✅ | python_module |
| XURL Skill | skill | `skill-xurl` | ✅ | python_module |

### ai-provider (5)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| DeepSeek Provider | extension | `ext-deepseek` | ✅ | python_module |
| HuggingFace Provider | extension | `ext-huggingface` | ✅ | python_module |
| Ollama Provider | extension | `ext-ollama` | ✅ | python_module |
| OpenAI API | service | `service-openai-api` | ✅ | api_call |
| OpenAI Provider | extension | `ext-openai` | ✅ | python_module |

### security (5)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Aegis | service | `aegis-safety` | ✅ | internal |
| ClawSafe | tool | `clawsafe` | ✅ | internal |
| LLM Safety Benchmark | tool | `llm-safety-benchmark` | ✅ | internal |
| Overlay AI-Safety | service | `overlay-safety` | ✅ | internal |
| Sentinel | service | `sentinel-monitor` | ✅ | internal |

### marketing (4)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Marketing Extension | extension | `ext-marketing` | ✅ | python_module |
| Marketing Tools Skill | skill | `skill-marketing-tools` | ✅ | python_module |
| Social Agent Extension | extension | `ext-social-agent` | ✅ | python_module |
| Social Media Dashboard | service | `social-media-dashboard` | ✅ | http_api |

### voice (3)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Swabble | tool | `swabble` | ✅ | cli_command |
| Voice Call Skill | skill | `skill-voice-call` | ✅ | python_module |
| Voice Extension | extension | `ext-voice` | ✅ | python_module |

### sports (2)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Bet Buddy | service | `bet-buddy` | ✅ | http_api |
| Sports Steve | agent | `sports-steve` | ✅ | http_api |

### core (2)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Enhanced Skill | skill | `skill-enhanced` | ✅ | python_module |
| Uplift Agent | agent | `uplift-agent` | ✅ | api_call |

### books (2)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Book-to-Skill Converter | skill | `book-to-skill` | ✅ | cli_command |
| Personal Book Synthesis | skill | `book-synthesis-personal` | ✅ | internal |

### development (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| MegaCode | agent | `megacode` | ✅ | http_api |

### utility (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| UFC-MCP | mcp_server | `ufc-mcp` | ✅ | mcp_stdio |

### commerce (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Gumroad Store | service | `service-gumroad` | ✅ | api_call |

### compliance (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| HempForge | service | `hempforge` | ✅ | http_api |

### music (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Indy Music Platform | service | `indy-music-platform` | ✅ | http_api |

### supply-chain (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Overlay Chain | service | `overlay-chain` | ✅ | http_api |

### community (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Block Hustlers Skill | skill | `skill-block-hustlers` | ✅ | python_module |

### knowledge (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| BookBridge Library Bridge | skill | `book-bridge` | ✅ | http_api |

### devops (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| GitHub Pull | skill | `github-pull` | ✅ | cli_command |

### productivity (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Trello Skill | skill | `skill-trello` | ✅ | python_module |

### data (1)

| Name | Kind | Slug | Active | Invocation |
| --- | --- | --- | --- | --- |
| Weather Skill | skill | `skill-weather` | ✅ | python_module |

## Capability Index

| Capability | Resources |
| --- | --- |
| agent_memory | sub-team |
| agentic_workforce | sub-team |
| ai-safety | aegis-safety, overlay-safety, clawsafe |
| alphafold | colabfold |
| analysis | fs-agent, hemp-os, uplift-agent, ext-autoresearch, ext-finance, ext-the-lab … |
| analytics | ghostfolio |
| anomaly_detection | overlay-chain |
| archetypes | sports-science |
| artist-sites | overlay-music |
| artist_site_build | indy-music-platform |
| audio | ufc-mcp, overlay-music |
| audit | draymond |
| audit_trail | hempforge |
| automation | hemp-os, lil-homie, otm-agent, uplift-agent, ext-browser, ext-marketing … |
| backtesting | skill-llm-trading-lab |
| bankroll_management | bet-buddy |
| bayesian | math-x |
| beat-production | tpc-beats |
| beat_management | indy-music-platform |
| bet_resolution | sports-steve |
| betting | skill-sports-betting |
| biomechanics | playgene, sports-science, injury-risk |
| biostats | math-x |
| biotech-research | overlay-science |
| blockchain | ext-overlay-chain, overlay-finance, the-block, skill-overlay-chain |
| blockchain_traceability | overlay-chain |
| book-production | book-writing-assistant, book-publishing-platform, overlay-writing |
| book-search | book-bridge |
| book-synthesis | book-synthesis-personal |
| book-to-skill | book-to-skill |
| book_pipeline | book-to-skill-chain |
| book_retrieval | bookbridge |
| book_search | bookbridge |
| boxing-sim | boxing-sim |
| bridging | skill-bridge |
| browser-automation | agent-browser |
| browser-control | ext-browser, browser-use |
| budget-management | ext-draymond-supervisor |
| budgeting | skill-budget-integration |
| bug-detection | codegang |
| business-solutions | overlay-business-solutions, overlay-finance |
| business_intelligence | sub-team |
| business_strategy | sub-team |
| caching | ext-claw-router |
| calling | skill-voice-call |
| campaign_management | social-media-dashboard |
| chat | lil-homie, uplift-agent, ext-deepseek, ext-huggingface, ext-ollama, ext-openai … |
| cheminformatics | overlay-science, moleculargraph |
| cis-contracts | mcp-cis-assistant |
| citations | bookbridge, book-bridge |
| clinical-metrics | disease-research |
| clinical-simulation | synop |
| coa_intake | hempforge |
| code-indexing | mutly |
| code-quality | phaselock |
| code-review | ext-the-lab, codegang |
| code_completion | megacode, uplift-agent, opencode |
| code_generation | sub-team |
| code_review | megacode |
| codebase-query | graphify |
| codegen | opencode |
| comic-builder | overlay-writing, comic-book-builder |
| commerce | service-gumroad |
| communication | skill-bridge |
| compliance | mcp-cis-assistant, overlay-safety |
| compliance_ledger | hempforge |
| composition | movie-scoring |
| confidence-gating | draymond |
| content-ip | overlay-writing |
| content-production | overlay-content |
| content_generation | hemp-os |
| contracts | book-publishing-platform |
| cost-optimization | ext-claw-router |
| cost-tracking | ext-claw-router |
| cpu_rtl_generation | sub-team, uplift-agent |
| creative_content | sub-team |
| cross_disciplinary_analysis | sub-team |
| cross_referencing | hemp-os |
| curriculum-guidance | ext-the-lab |
| daily_bet_assessment | sports-steve |
| data-retrieval | ext-finance, skill-weather |
| data_provider | kaggle |
| data_science | sub-team |
| database | service-local-sqlite |
| dataset_download | kaggle |
| dataset_search | kaggle |
| deep-analysis | codegang |
| demand_forecast | overlay-chain |
| deployment | service-vercel |
| device-control | skill-remote-control |
| dfir | ext-cyber-security |
| distribution | service-gumroad, indy-music-platform, overlay-music, sovereign-music-studio, wholesale-marketing-channel |
| document-parsing | book-to-skill |
| document-to-markdown | ufc-mcp |
| editing | opencode |
| education | ext-the-lab |
| embedding | ext-huggingface, ext-memory-lancedb, ext-openai, service-openai-api |
| enforcement | phaselock |
| engagement | ext-social-agent |
| evaluation | llm-safety-benchmark |
| execution | skill-open-sandbox |
| experiment-tracking | ext-autoresearch |
| experimentation | skill-digital-lab |
| explain | graphify |
| extraction | skill-xurl |
| fan_capture | indy-music-platform |
| fan_crm | indy-music-platform |
| file-conversion | ufc-mcp |
| film-scoring | movie-scoring |
| finance | the-block |
| financial-planning | ext-the-bank |
| financial-strategy | fs-agent, overlay-finance |
| forensics | ext-cyber-security |
| framework-extraction | book-to-skill |
| framework_extraction | book-to-skill-chain |
| gamification | skill-block-hustlers, block-2 |
| generation | hemp-os, otm-agent, uplift-agent, ext-autoresearch, ext-deepseek, ext-huggingface … |
| github-search | github-pull |
| gpu-training | ext-autoresearch |
| graph-observer | deterministic-brain |
| grounding | book-bridge |
| guardrails | overlay-safety |
| health-checking | ext-draymond-supervisor |
| hosting | service-vercel |
| hyperparameter-tuning | ext-autoresearch |
| ide | vibeserve |
| identity | ext-overlay-chain, skill-overlay-chain |
| illustration | comic-book-builder |
| image | ufc-mcp |
| image_generation | social-media-dashboard |
| injury-risk | sports-science, injury-risk |
| inventory_optimization | overlay-chain |
| invoicing | service-stripe |
| ip-builder | ip-builder-platform |
| ip-portfolio | ip-builder-platform, overlay-finance |
| ip_comparison | recursive-ip |
| ip_grading | recursive-ip |
| ip_registry | recursive-ip |
| ip_relationships | recursive-ip |
| ip_search | recursive-ip |
| kelly_criterion | sports-steve, bet-buddy |
| knowledge-graph | graphify |
| knowledge_graph | bookbridge |
| lab-director | biotech-ide |
| label-management | nc-sound |
| learning-paths | ext-the-lab |
| library_distillation | book-to-skill-chain |
| listening | swabble |
| literature_intelligence | hempforge |
| llm-safety-benchmark | overlay-safety, llm-safety-benchmark |
| load-balancing | ext-claw-router |
| local-scoring | codegang |
| market-analysis | ext-the-bank |
| market_sentiment | trading-agents |
| marketing | ext-marketing, skill-marketing-tools, super-tool |
| math | math-x |
| mcp | vibeserve |
| megacode_bridge | uplift-agent |
| memory | draymond, ext-engram, ext-memory-lancedb, ext-mem0, ext-memory-core, skill-engram … |
| metacognition | deterministic-brain |
| metrics | codex-metrics |
| milestones | reporank |
| mixing | sovereign-music-studio |
| ml-research | ai-scientist, ext-autoresearch |
| model-routing | ext-claw-router |
| molecular-graph | moleculargraph |
| monitoring | draymond, ext-draymond-supervisor, sentinel-monitor |
| monte-carlo | math-x |
| multi-agent | ext-claw-team, ext-draymond-supervisor, ext-paperclip, skill-trading-agents |
| multi-agent-pipeline | codegang |
| multi-tool-agent | opencode |
| multi_agent_coding | megacode |
| music | skill-spotify-player |
| music-production | overlay-music, sovereign-music-studio, skill-sovereign-music, dustcrate |
| music-publishing | nc-sound |
| music-rights | overlay-music |
| nft_minting | recursive-ip |
| notion_sync | omni-research |
| novelty-checking | ai-scientist |
| odds-modeling | boxing-sim |
| odds_analysis | sports-steve |
| odds_calculation | bet-buddy |
| onco-metrics | disease-research |
| opportunity-scanning | otm-agent |
| orchestration | draymond, uplift-agent, ext-draymond-supervisor, ext-paperclip, agent-browser, everything-claude-code … |
| outreach | otm-agent |
| paper-generation | ai-scientist |
| paper_generation | hemp-os |
| parallel-execution | ext-claw-team |
| path-tracing | graphify |
| payments | service-stripe |
| pen-testing | ext-cyber-security |
| personalized-notes | book-synthesis-personal |
| planning | overlay-business-solutions, skill-budget-integration |
| play-genome | playgene |
| playback | skill-spotify-player |
| podcast_creation | social-media-dashboard |
| portfolio-tracking | ext-the-bank, ghostfolio |
| portfolio_analytics | recursive-ip |
| prediction | skill-sports-betting |
| preset_marketplace | indy-music-platform |
| progress-tracking | mutly, reporank |
| project-management | skill-trello |
| proposals | deterministic-brain |
| protein-structure | overlay-science, colabfold |
| prototyping | skill-digital-lab |
| provenance | bookbridge, book-bridge |
| publishing | book-publishing-platform, overlay-writing |
| qa-testing | agent-browser |
| quality-gates | reporank |
| reading-plan | book-bridge |
| reading_plan | bookbridge |
| reasoning | skill-enhanced |
| rebalancing | ext-the-bank |
| recommendations | skill-spotify-player |
| red-teaming | ext-cyber-security |
| registry-registration | github-pull |
| regulatory-scaffolding | synop |
| regulatory_risk | hempforge |
| remediation | reporank |
| repo-grading | grader |
| repo-scoring | reporank |
| reporting | hempforge, ghostfolio |
| reputation | skill-overlay-chain |
| research | hemp-os, sub-team |
| research-orchestration | biotech-ide, overlay-science |
| research_feed | kaggle |
| research_generation | omni-research |
| resource-pull | github-pull |
| result-synthesis | ext-claw-team |
| retrieval | ext-engram, book-bridge, skill-engram |
| risk_assessment | trading-agents, overlay-chain |
| robo-advisory | ext-the-bank |
| run-coaching | sports-science, run-coach |
| sample-management | det-engine-soundbank |
| sandbox-testing | mutly |
| sandboxing | skill-open-sandbox |
| scaffolding | skill-creator |
| scenario_simulation | overlay-chain |
| scientific-engine | biotech-ide |
| scoring | grader |
| scraping | ext-browser, skill-xurl, browser-use |
| screenshot_ocr | bet-buddy |
| search | uplift-agent, ext-mem0, skill-mem0, skill-weather |
| security-scanning | ext-cyber-security, overlay-safety, sentinel-monitor, clawsafe, codegang |
| security_analysis | sub-team |
| self-reflection | deterministic-brain |
| semantic-search | mutly |
| signals | skill-trading |
| simulation | fs-agent, hemp-os, overlay-science |
| skill-generation | book-to-skill |
| skill-installation | github-pull |
| skill_execution | uplift-agent |
| skill_registration | book-to-skill-chain |
| slack_share | omni-research |
| smart_links | indy-music-platform |
| smiles | moleculargraph |
| snapshotting | kaggle |
| social-media | ext-social-agent |
| social_posting | social-media-dashboard |
| social_scheduling | indy-music-platform |
| sound-design | det-engine-soundbank, tapsynth |
| speech | service-openai-api |
| speech-recognition | ext-voice |
| sports-analytics | sports-science, codex-metrics |
| sports-simulation | playgene |
| sports_statistics | bet-buddy |
| spreadsheet | ufc-mcp |
| stock_analysis | trading-agents |
| storage | ext-engram, ext-mem0, ext-memory-core, service-local-sqlite, skill-engram, skill-mem0 |
| sub_team_pipeline | uplift-agent |
| subcontractor-onboarding | mcp-cis-assistant |
| subscriptions | service-stripe |
| summarization | bookbridge, book-bridge, skill-summarize |
| supply_chain_query | overlay-chain |
| swarm-orchestration | ext-claw-team |
| sweep | deterministic-brain |
| symbol-extraction | mutly |
| synthesis | tapsynth |
| systems_architecture | sub-team |
| task-dag | biotech-ide |
| task-delegation | ext-claw-team |
| tax-deductions | mcp-cis-assistant |
| text-to-speech | ext-voice |
| text_generation | social-media-dashboard |
| threat-detection | aegis-safety, overlay-safety, sentinel-monitor |
| ticket_to_pr | megacode |
| tracking | skill-block-hustlers, skill-budget-integration, block-2 |
| trading | ext-finance, skill-llm-trading-lab, skill-trading-agents, skill-trading, super-tool |
| trading_signals | trading-agents |
| treatment-planning | disease-research |
| trend_detection | hempforge |
| tutoring | ext-the-lab |
| ui_generation | vibeserve |
| utility | ufc-mcp |
| validation | mcp-cis-assistant, phaselock |
| vector-search | ext-memory-lancedb |
| version_history | recursive-ip |
| vibe_coding | megacode |
| video | ufc-mcp |
| video-creation | money-printer-turbo |
| video-processing | skill-video-frames |
| video_generation | social-media-dashboard |
| visual-reports | book-synthesis-personal |
| voice | ext-voice, skill-voice-call |
| voice-activation | swabble |
| voice_synthesis | social-media-dashboard |
| vulnerability-analysis | ext-cyber-security |
| wealth-analysis | ext-the-bank |
| web-scraping | agent-browser |
| web_search | omni-research |
| wholesale-marketing | overlay-finance, wholesale-marketing-channel |
| workflow_management | hempforge |
| writing | book-writing-assistant |
