# Qlix MCP Service

First-party MCP HTTP server for Qlix. Runs as the `qlix-mcp` PM2 process alongside `qlix-backend`.

## Endpoints

- `POST /mcp-jobs` — **qlix-jobs** (Job Apply Copilot — Greenhouse / Lever / Ashby)
- `POST /mcp-schedule` — **qlix-schedule** (scheduled agent events)
- `/sandbox` — binary file store (resumes, report PDFs)

## Jobs tools

- `upsert_candidate_profile`, `search_jobs`, `queue_applications`
- `list_applications`, `get_apply_brief`, `record_application_result`

## Schedule tools

- Create, list, get, update, and cancel scheduled agent events

## Env

Copy `.env.example` → `.env`. `SERVICE_SECRET` must match `QLIX_INTERNAL_SERVICE_SECRET` in the backend.

## Local

```bash
npm ci
cp .env.example .env   # edit values
npm start              # http://127.0.0.1:3940/mcp-jobs and /mcp-schedule
```
