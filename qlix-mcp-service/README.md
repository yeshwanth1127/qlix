# Qlix MCP Service

First-party MCP HTTP server for Qlix. Runs as the `qlix-mcp` PM2 process alongside `qlix-backend`.

## Endpoints

- `POST /mcp` — **qlix-leads** (GMB scrape / outreach)
- `POST /mcp-jobs` — **qlix-jobs** (Job Apply Copilot — Greenhouse / Lever / Ashby)
- `/sandbox` — binary file store (resumes, report PDFs)
- `/scrape` — async GMB scrape jobs

## Leads tools

- `gmb_search_leads` — create campaign + start GMB scrape
- `get_campaign`, `list_leads`, `export_leads`
- `start_outreach` — queue outreach via Qlix internal API

## Jobs tools

- `upsert_candidate_profile`, `search_jobs`, `queue_applications`
- `list_applications`, `get_apply_brief`, `record_application_result`

## Env

Copy `.env.example` → `.env`. `SERVICE_SECRET` must match `QLIX_INTERNAL_SERVICE_SECRET` in the backend.

## Local

```bash
npm ci
cp .env.example .env   # edit values
npm start              # http://127.0.0.1:3940/mcp and /mcp-jobs
```

GMB scraping uses Playwright. On first deploy run `npx playwright install chromium` if scrape jobs fail.
