# Qlix

Monorepo: **`frontend/`** (Next.js) and **`backend/`** (Node.js + Express + Prisma).

- Product spec: [AGENTS.md](AGENTS.md)
- Cursor rules: [.cursor/rules/](.cursor/rules/)

## Environment variables

| Variable | Where | Purpose |
|--------|--------|---------|
| **`JWT_SECRET`** | **[`backend/.env`](backend/.env)** only | Signs and verifies session JWTs. **Never** put this in the frontend repo or in any `NEXT_PUBLIC_*` variable — it would ship to the browser. |
| **`DATABASE_URL`** | **`backend/.env`** | PostgreSQL connection string for Prisma. |
| **`FRONTEND_URL`** | **`backend/.env`** | Allowed browser origin for CORS + cookie flows (e.g. `http://localhost:3000`). |
| **`NEXT_PUBLIC_API_BASE_URL`** | **`frontend/.env`** (or `.env.local`) | Public API base URL embedded at build time. Not secret; only the API address. |

Next.js loads `.env`, `.env.development`, `.env.local`, etc. ([order of precedence](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)). Using **`frontend/.env`** for `NEXT_PUBLIC_*` is fine; `.env.local` is optional if you prefer overrides per machine.

## Run locally

**Backend** — copy [backend/.env.example](backend/.env.example) → **`backend/.env`** and set **`JWT_SECRET`** (16+ characters) and **`DATABASE_URL`**:

```bash
cd backend
npm install
cp .env.example .env

npx prisma migrate dev --name init
# or: npx prisma db push

npm run dev
```

**Frontend** — copy [frontend/.env.example](frontend/.env.example) → **`frontend/.env`**:

```bash
cd frontend
npm install
cp .env.example .env

npm run dev
```

Auth uses **httpOnly cookies** on the API origin (`localhost:4000`). The UI calls `NEXT_PUBLIC_API_BASE_URL` with `credentials: 'include'`.
