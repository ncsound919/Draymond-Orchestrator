# The Uplift Lab

**The Operating System for Black Community Empowerment**

The Uplift Lab is a modular, community-owned digital platform engineered to directly address systemic barriers facing the Black community across six critical domains: education, health, finance, entrepreneurship, justice, and community support. Built by and with the community — never extracting, always uplifting.

## Membership

**Membership at The Uplift Lab is, and always will be, $0.**

We believe that access to empowerment tools should not be behind a paywall. Every module, from financial literacy to life skills training, is accessible for free to all community members.

- **Easy Access:** Simple signup process with no credit card required.
- **Always Free:** No hidden fees, no \"pro\" tiers, no catch.
- **Community Owned:** Data sovereignty and community governance at the core.

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, TypeScript)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Fonts**: Inter (body), Space Grotesk (headings) — loaded via system font stack
- **Architecture**: Static site generation (SSG) for all pages

## Brand Colors

| Token | Hex | Usage |
|---|---|---|
| Forest Green | `#2d4a1a` | Primary background, nav, CTAs |
| Warm Gold | `#c8a415` | Accent, highlights, CTAs |
| Soft Cream | `#faf6e6` | Page background |
| Deep Burgundy | `#6b2137` | Stats section |
| Rich Brown | `#6b4226` | Text accents |

## Modules

| Module | Domain | Status |
|---|---|---|
| **Uplift Learn** | Education & Digital Literacy | **Active** (Life Skills & Mentorship) |
| Uplift Health | Health & Wellness | Coming Soon |
| **Uplift Wealth** | Financial Empowerment | **Active** (Financial Literacy) |
| Uplift Ventures | Entrepreneurship | Coming Soon |
| Uplift Justice | Legal Aid & Criminal Justice | Coming Soon |
| Uplift Community | Community Support & Mutual Aid | Phase 0 |

## Key Files

- `src/components/MembershipBanner.tsx` — Call-to-action for free membership.
- `src/components/HistoryHeroes.tsx` — Interactive Black history component.
- `Scaffold` — Full platform architecture & development blueprint.
- `src/app/` — Next.js App Router pages.
- `supabase/migrations/` — Database schema and security policies.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.
