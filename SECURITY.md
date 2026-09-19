# Security Policy

## Supported versions

Draymond Orchestrator is a self-hosted, single-operator application. Security
fixes are applied to the latest `main` and the most recent release only.

| Version | Supported |
|---------|-----------|
| latest release | ✅ |
| older releases | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Report it privately
via GitHub Security Advisories ("Report a vulnerability" on the repository's
Security tab) or email the maintainer listed in `package.json`.

Include: affected version/commit, a reproduction, impact, and any suggested fix.
You can expect an acknowledgement within 72 hours and a remediation plan or
triage decision within 7 days.

## Security model (what to know before reporting)

- **Local-first, private instance.** State lives in a local SQLite file
  (`data/draymond.db`); there is no hosted multi-tenant backend.
- **Session auth.** Dashboard pages are gated by an httpOnly session cookie
  (`src/proxy.ts`). API routes are not gated by the proxy — each route performs
  its own authorization itself (`requireDraymondAuth`, `authorizeRequest`,
  `requireMathAuth`, Bearer secrets, Stripe signature verification, or the
  `purchases` gate for downloads).
- **Secrets.** Real credentials live only in the gitignored `.env.local` (or the
  KeyWire vault). `.env.example` contains placeholders only. Never commit real
  keys; rotate immediately if one is exposed.
- **Outbound calls.** External services (LLM providers, ntfy, Gmail, Stripe)
  are optional; when unconfigured the app degrades rather than fabricating data.

## Dependency and supply-chain hygiene

- `npm ci` installs from the committed `package-lock.json`.
- Dependabot/Renovate is recommended for ongoing dependency updates; run
  `npm audit` and `scripts/local-supply-chain.ts` periodically.
- Native modules (`better-sqlite3`, `sharp`, `sqlite-vec`) are pinned via the
  lockfile.
