# Draymond — Rebuild & Recovery Guide

> The honest companion to `OPS.md`. Where OPS.md explains *how the stack works*,
> this file documents *how to rebuild it from a broken state* and what is
> hardcoded and needs fixing. Modeled on the kernel `kernel_compile.txt` style:
> write down the steps, and admit what is machine-specific.

## Golden rules

1. **Run everything from `Draymond-Orchestrator\`.** Several scripts resolve
   sibling repos relative to the orchestrator root and break if you `cd`
   elsewhere.
2. **A rebuild must never lose live state.** The Next standalone server
   `chdir()`s into `.next/standalone` at boot. The env pins in
   `ecosystem.config.js` (`DRAYMOND_DB_PATH`, `DRAYMOND_REGISTRY_DIR`) exist
   exactly so the DB and `.draymond/` brain state keep living at the real
   root instead of being silently forked into build-time copies. Do not
   remove those pins.
3. **The fleet ALWAYS uses the Go LLM tier** (`zen/go/v1`, model
   `deepseek-v4-flash`). Never fall back to the free tier as the backbone —
   it 429s and hangs sessions. Details in `OPS.md`.

## Rebuild the orchestrator (Next.js)

```powershell
# from Draymond-Orchestrator\
npm run build          # = prebuild (prune .next) + next build -> .next/standalone
npm run verify:build   # drift check: compares artifacts vs data/build-manifest.json
pm2 restart draymond   # pick up the new build
pm2 save               # persist process list
```

- `prebuild` runs `scripts/prune-next.mjs`, which deletes `.next` so the
  Turbopack file tracer doesn't walk the whole ecosystem and hang the build.
- `scripts/build-draymond.bat` now runs `scripts/verify-build.mjs` after the
  build: it asserts `.next/standalone/server.js`, `package.json`, and
  `.next/BUILD_ID` exist, then records a build manifest (git sha + artifact
  hashes) to `data/build-manifest.json`. A build that produced no server is a
  failed build. `npm run verify:build` compares the live artifacts against
  that manifest and fails on drift — the fleet's `-INCREMENTAL:NO` guard.
- The incremental TypeScript cache (`tsconfig.tsbuildinfo`) is **not** used for
  the server build; don't rely on it for incremental builds — treat every
  build as a full build.

## Start the fleet under pm2

```powershell
pm2 resurrect                    # restore the saved fleet after a daemon crash
pm2 start ecosystem.config.js    # Draymond itself (fork, autorestart, memory cap)
pm2 start ecosystem.marketing.config.js --only opencode   # codegen serve (Go tier)
pm2 start ecosystem.fleet.config.js   # cloudflared, hermes-brain, litellm, agents, Open-Chat
pm2 save
```

All service definitions live in **`fleet-manifest.js`** — the fleet "linkmap".
The four `ecosystem.*.config.js` files are thin consumers of it. Add, remove,
or re-parameterize a service there, not in the pm2 configs. Current count:
24 apps (1 core + 15 fleet + 7 marketing + 1 brain).

## Recovery drill (in order)

1. **Is the orchestrator up?** `curl http://localhost:3444/` — if not:
   `pm2 restart draymond`, then check `data\logs\draymond-error.log`.
2. **Is the brain state intact?** Confirm `.draymond\*.json` files exist and
   have recent mtimes. A build that forked them (see golden rule 2) will look
   like "everything works but nothing remembers anything" — restore from the
   real root, not the standalone copy.
3. **Is the codegen path alive?** LiteLLM on `:4100` is the primary route to
   `zen/go/v1`. If it's down: `pm2 start ecosystem.fleet.config.js --only litellm`
   (or `scripts/start-litellm.ps1`). Fallback: local `opencode serve` on `:4096`.
4. **Are monitors firing?** `pm2 logs draymond | findstr /i monitor`. Benign
   signals are whitelisted via `DRAYMOND_IGNORE_SIGNALS` (see below) — if you
   see "on-call" spam for known noise, add them to the whitelist.
5. **Repair loop escalation?** `detectRepairLoops` reports signals re-applied
   beyond the loop threshold. Check `.draymond\repair-log.json` for the
   signal; the repair is *not* working — fix the root cause, don't extend the
   cooldown.

## Known benign signals (whitelist)

Set `DRAYMOND_IGNORE_SIGNALS` to suppress known-noise monitors so they never
escalate or consume LLM budget:

```powershell
set DRAYMOND_IGNORE_SIGNALS=monitor:maintenance,monitor:dev-tools
```

Add it to `.env.local` so the config loader picks it up. Semantics:
- The signal is recorded in `repair-log.json` with status `skipped`.
- No command runs, no on-call escalation, no LLM scorers in `repair-triage`.
- A signal NOT on the list behaves exactly as before (unknown = escalate).

## Boot order (declarative graph)

`bootstrap.ts` starts core services in topological order of the `BOOT_GRAPH`
(`depends_on` edges), not the raw array. All edges are empty by default so the
declaration order is preserved. Add a dependency — e.g. only start `hempforge`
after `hemp-os` is up — via env without a code change:

```powershell
set DRAYMOND_BOOT_GRAPH={"hempforge":{"dependsOn":["hemp-os"]}}
```

Unknown deps and cycles are logged and skipped, never dead-locked.

## Hardcoded paths — machine-specific, fix before moving machines

Paths are now centralized in **`fleet-manifest.js`** (the `P()`/`O()` helpers
derived from `UPLIFT_ROOT`, plus `PYTHON`, `NODE`, `OPENCODE_BIN`,
`CLOUDFLARED_BIN`). On a new machine set `UPLIFT_ROOT` (and the interpreter
paths if they differ) instead of editing every config. Residual hardcoded
values still to parameterize:

| Value | Where | Notes |
|---|---|---|
| `C:\Users\User\.cloudflared\config.yml` | `fleet-manifest.js` (cloudflared args) | cloudflare tunnel config |
| `C:\Users\User\AppData\Local\Programs\Python\Python310\Scripts\litellm.exe` | `fleet-manifest.js` (litellm script) | litellm launcher (env `LITELLM_BIN` override) |

Interpreter defaults honored (overridable): `PYTHON_PATH` →
`C:\Program Files\Python312\python.exe`, `NODE_PATH` →
`C:\Program Files\nodejs\node.exe`, `OPENCODE_BIN` →
`...\npm\node_modules\opencode-ai\bin\opencode`, `CLOUDFLARED_BIN` →
`C:\Program Files (x86)\cloudflared\cloudflared.exe`.

**Refactor done:** every `cwd:` in the old configs was scattered as a literal
path; those now derive from `UPLIFT_ROOT` in one place. This was the
known-hardcoded area — same warning the kernel build notes gave: "some stuff
has been hardcoded ... you will need to fix them." The remaining two values
above are the stragglers.

## Env pins that must survive a rebuild

| Env | Value | Why it must stay |
|---|---|---|
| `DRAYMOND_DB_PATH` | `...\Draymond-Orchestrator\data\draymond.db` | standalone server would fork the DB on rebuild |
| `DRAYMOND_REGISTRY_DIR` | `...\Draymond-Orchestrator\.draymond` | brain state must live at real root |
| `ALLOW_LOCAL_AGENTS` | `1` | local fleet calls would fail the SSRF guard under `NODE_ENV=production` |
| `GMAIL_USE_OAUTH` | `1` | use the OAuth refresh token (hermes-proxy), not SMTP app password |
| `DRAYMOND_FAILOVER_MATRIX` | `1` | weak-agent failover auto-apply (fail-closed when unset) |

## Where the build knowledge lives

- `OPS.md` — stack, LLM tiers, codegen order, business model.
- `REBUILD.md` (this file) — recovery, hardcoded paths, env pins.
- `fleet-manifest.js` — single source of truth for every PM2 service (the fleet "linkmap").
- `scripts\build-draymond.bat` — raw `next build` + artifact verification.
- `scripts\verify-build.mjs` — build determinism: record + drift-check the build manifest.
- `scripts\start-*.ps1` — per-service launchers (litellm, hermes, aetherdesk, tools).
- `src\lib\draymond\ports.ts` — the canonical port registry (single source of
  truth for ports).
