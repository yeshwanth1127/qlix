# Qlix backend (Node.js)

HTTP API for Qlix: Express, TypeScript (strict), Prisma + PostgreSQL.

## Requirements

- Node.js 20+
- PostgreSQL (local or hosted)

## Setup

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL

npm install
npm run db:generate
npm run db:migrate   # after first migration exists, or use db:push for prototyping
npm run dev
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Watch mode with `tsx` |
| `npm run build` | Compile to `dist/` |
| `npm run start` | Run compiled `dist/main.js` |
| `npm run db:generate` | Prisma Client |
| `npm run db:migrate` | Create/apply migrations |
| `npm run db:push` | Push schema (no migration files) |
| `npm run db:studio` | Prisma Studio |

## HTTP

- **GET** `/api/v1/health` — liveness
- **POST** `/api/v1/auth/signup` — JSON `{ email, password, displayName?, workspaceType? }` — sets `qlix_session` httpOnly cookie
- **POST** `/api/v1/auth/login` — JSON `{ email, password }`
- **POST** `/api/v1/auth/logout` — clears session cookie
- **GET** `/api/v1/auth/me` — current user (requires cookie)

API prefix: `/api/v1`. Set `FRONTEND_URL` to match your Next.js origin so CORS + cookies work.
