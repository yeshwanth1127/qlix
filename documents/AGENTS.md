# Qlix — agent and human reference

Authoritative Cursor rules live in [`.cursor/rules/`](.cursor/rules/). The codebase is split into **`frontend/`** (Next.js UI) and **`backend/`** (Node.js API).

## What is Qlix?

Qlix is a web platform that serves as the **developer console** and **identity management layer** for the **Exora** ecosystem — trust and identity infrastructure for AI agents. Think AWS Console or Stripe Dashboard for developers and companies building, deploying, and managing autonomous AI agents on the web.

Qlix is **not** a project management tool. Two primary functions:

1. **Agent identity management** — register, manage, and certify AI agents with cryptographic identities (DIDs + Verifiable Credentials). **Exora Layer 3.**
2. **Audit ledger** — tamper-proof, real-time log of every action an agent takes: who did what, when, on whose behalf. **Exora Layer 5.**

Qlix is the web interface on top of those two backend systems.

## Exora ecosystem (context)

| Layer | Product | Notes |
|-------|---------|--------|
| 1 | Ira | Desktop/web agent app (flagship, future) |
| 2 | Platform | Skill & trust marketplace (future) |
| 3 | Agent cert | Cryptographic identity (**building now → Qlix**) |
| 4 | Action APIs | Browsing & action execution (future) |
| 5 | Core infra | Sovereign ledger + billing + governance (**building now → Qlix**) |

**Current build scope:** Layer 3 and Layer 5 only. Qlix is the frontend for both. Layers 1, 2, and 4 are out of scope unless the project is explicitly re-scoped.

## Who uses Qlix?

Two user types, separated at onboarding (no mixed mode at signup).

**Individual** — Solo developers: register agents, issue credentials, inspect action logs; personal workspace only.

**Organization** — Companies/teams: shared agent registries, members, team-level audit, compliance views, admin controls, billing.

**Onboarding:** After email signup, one screen: “Are you using this for yourself or your team?” — two cards (individual / organization). The app shell adapts to the choice.

## Information architecture

### Individual path

- `/` — home / overview
- `/agents`, `/agents/:id` — agents and detail (credentials, status, action history)
- `/audit` — personal audit log
- `/credentials` — VCs, DID document, keys
- `/api-keys` — API keys
- `/settings` — profile, security, danger zone

### Organization path

- `/` — org overview
- `/agents`, `/agents/:id` — org registry + team ownership on detail
- `/audit`, `/audit/policies` — org audit + policy rules
- `/members`, `/teams` — membership and teams
- `/credentials` — org-level VCs and DIDs
- `/billing` — plan, usage, invoices, credits
- `/settings` — org settings, SSO, danger zone

### Shared (unauthenticated)

Landing, `/pricing`, `/docs`, `/blog`, `/login`, `/signup` (signup → onboarding split). Route `/` for marketing vs authenticated home must be resolved with auth-based routing or layout groups.

## Dashboards

**Individual home:** Metric cards — active agents (+ online), actions today (+ % vs yesterday), credentials (+ validity). Sections: **My agents** (compact list with status); **Recent audit** (10 rows, link to full log). Sidebar CTA: upgrade to org.

**Org home:** Metrics — registered agents, actions this week, policy violations (0 is good). Two columns: **Agent registry** (by activity, team, status); **Members** (avatars, team, role, +N). Full-width **Audit** with distinct styling for admin/system vs agent actions.

## Agent detail

Shared layout; org adds **transfer ownership** and **assign team**.

Header: name, DID, status, dates. Tabs: **Credentials**, **Actions**, **Settings** (rename, keys, scope, suspend, delete).

## Audit log page

Compliance/security tone. Columns: timestamp (with timezone); agent (link); action type (READ, WRITE, AUTH, POLICY_CHANGE, SYSTEM); description; actor; result (success / blocked / flagged).

Filters: date range, agents, type, result, search. **CSV** export org-only. Visuals: blocked = amber left border; flagged = red border + elevated background; POLICY_CHANGE / SYSTEM muted.

## Tech stack

Next.js 14+ App Router, TypeScript strict, Tailwind, shadcn/ui, Lucide (16px), TanStack Query, Zustand, RHF + Zod. Prisma + PostgreSQL + Redis. JWT in httpOnly cookies. Vercel; Railway or Supabase early. Auth: email/password → magic link → OAuth → org SSO.

## Core tables (conceptual)

`users`, `organizations`, `org_members`, `agents`, `credentials`, `audit_events`, `api_keys` — see [`qlix-database.mdc`](.cursor/rules/qlix-database.mdc) for fields.

## Design system (summary)

Dark-first, macOS-like chrome: layered surfaces, thin borders, no card shadows. CSS variables for all colors; max font weight 500 in dashboard; no Inter/Google Fonts. Layout: `h-12` topbar, `w-52` sidebar, `max-w-5xl` content except full-width audit. Full token and class recipes: [`qlix-design-system.mdc`](.cursor/rules/qlix-design-system.mdc).

## UX conventions

Truncate DIDs/keys in tables; copy with checkmark feedback. Meaningful empty states and skeleton loading. Confirm destructive actions; type agent name to delete. Realtime audit with “N new events” when scrolled. Org switcher in topbar. **Member** role: hide Billing, org Settings, delete agent — do not grey out only.
