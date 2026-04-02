# Contributing to The Uplift Lab

Thank you for your interest in contributing. The Uplift Lab is a community-owned platform built to dismantle systemic barriers facing the Black community. Every contribution — code, design, documentation, or community feedback — advances that mission.

## Mission Alignment

Before contributing, please read the [Scaffold](./Scaffold) document to understand the full vision, architecture, and principles driving this project. All contributions must align with the six core principles:

1. Empowerment over Dependency
2. Community Ownership
3. Data Sovereignty
4. Culturally Resonant UX
5. Accessibility as Non-Negotiable
6. Modularity over Monolith

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/ncsound919/The-Uplift-Lab.git
cd The-Uplift-Lab

# 2. Install dependencies
npm install

# 3. Copy env example and fill in your Supabase credentials
cp .env.example .env.local

# 4. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

See `.env.example` for all required variables. At minimum you need:

- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your Supabase anon key
- `NEXT_PUBLIC_APP_URL` — set to `http://localhost:3000` for local dev

For the AI Uplift Guide feature:
- `OPENAI_API_KEY` — your OpenAI API key

## Development Workflow

1. Create a branch: `git checkout -b feat/your-feature-name`
2. Make your changes following the code style below
3. Run `npm run lint` and `npm run type-check` before pushing
4. Open a Pull Request against `main` with a clear description

## Code Style

- **TypeScript** — all new files must be `.ts` or `.tsx`. No `.js`/`.jsx`.
- **Tailwind CSS** — use utility classes; avoid inline `style` props except for dynamic values
- **Module-first architecture** — new features belong in the relevant module route (`/modules/learn`, `/modules/health`, etc.)
- **Server Components by default** — only add `'use client'` when you need interactivity, browser APIs, or React hooks
- **Accessibility** — all interactive elements need visible focus states, ARIA labels, and keyboard support. WCAG 2.2 AA is the minimum bar.

## Database Changes

All schema changes must be in a numbered migration file under `supabase/migrations/`. Never modify existing migration files — always add a new one.

## PR Requirements

- [ ] `npm run lint` passes
- [ ] `npm run type-check` passes
- [ ] `npm run build` passes locally
- [ ] New interactive components have keyboard support and ARIA attributes
- [ ] Any new API routes validate input and handle errors gracefully
- [ ] Related section in the `Scaffold` document is referenced in the PR description if applicable

## Community Standards

This project follows a Code of Conduct rooted in the values of the communities we serve. Respect, dignity, and inclusion are non-negotiable. Contributions that demean, exclude, or harm any community member will not be accepted.

## Questions?

Open a GitHub Issue or connect through the Uplift Community module once it is live.
