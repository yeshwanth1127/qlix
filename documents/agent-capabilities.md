# Agent capabilities & tools

What an agent on Qlix can do. Capabilities are granted as **permission scopes** on the agent’s credential. Scopes unlock concrete **SDK tools** at runtime. Sensitive actions may require **JIT** (just-in-time) human approval before they run. Every consequential tool call is signed and recorded on the Layer 5 audit ledger.

```
Permission scopes (catalog + mcp.*)
        │
        ▼
SDK tool groups → concrete tools
        │
        ▼
JIT (if required) → signed action start → execute → action complete
        │
        ▼
Hash-chained audit log
```

**Source of truth for scopes:** `backend/src/agents/scopeCatalog.ts`  
**Runtimes:** `cloud` (remote runner) · `hybrid` (local machine + cloud) · `local`

---

## 1. Permission scopes

Scopes are not free-form. Each builtin scope maps to real tools in the SDK. Orgs can disable scopes; connector-gated scopes need a linked connector at run time.

| Scope | Label | What it unlocks | JIT | Connector | Runtimes |
|-------|-------|-----------------|-----|-----------|----------|
| `web.read` | Read web pages | Browse / fetch pages | No | — | cloud, hybrid |
| `web.research` | Web research (platform APIs) | Structured search (Twitter, Reddit, GitHub, YouTube, Bilibili, open web) — no browser | No | — | cloud, hybrid |
| `web.click` | Click on web pages | Click links and buttons | No | — | cloud, hybrid |
| `web.transaction` | Submit web forms / transactions | Forms, checkouts, purchases | **Yes** | — | cloud, hybrid |
| `system.file_read` | Read local files | Read filesystem | No | — | **hybrid** |
| `system.file_write` | Write local files | Write / modify files | **Yes** | — | **hybrid** |
| `system.gui_control` | Control desktop apps | Screen automation | **Yes** | — | **hybrid** |
| `finance.spend_50` | Spend up to $50 | Authorize spend ≤ $50 | **Yes** | — | cloud, hybrid, local |
| `finance.spend_100` | Spend up to $100 | Authorize spend ≤ $100 | **Yes** | — | cloud, hybrid, local |
| `brain.query` | Query company AI brain | Query org AI brain | No | — | cloud, hybrid |
| `brain.knowledge_read` | Read org knowledge | Read indexed knowledge base | No | — | cloud, hybrid |
| `email.read` | Read Gmail | Read connected inbox | No | Google | cloud, hybrid |
| `email.send` | Send email | Send via Gmail | **Yes** | Google | cloud, hybrid |
| `drive.read` | Read Google Drive | List / read Drive files | No | Google | cloud, hybrid |
| `drive.write` | Write to Google Drive | Create / update Drive files | **Yes** | Google | cloud, hybrid |
| `calendar.read` | Read Google Calendar | List / read calendar events | No | Google | cloud, hybrid |
| `calendar.write` | Write to Google Calendar | Create / update calendar events | **Yes** | Google | cloud, hybrid |
| `meet.manage` | Google Meet | Create / manage Meet links | **Yes** | Google | cloud, hybrid |
| `youtube.read` | Read YouTube | Search / read YouTube via Google | No | Google | cloud, hybrid |
| `youtube.publish` | Publish to YouTube | Upload / update YouTube videos | **Yes** | Google | cloud, hybrid |
| `whatsapp.send` | Send files to linked WhatsApp | File to self-chat | No | WhatsApp (Baileys) | cloud, hybrid |
| `whatsapp.read` | Read WhatsApp chats | List contacts + read 1:1 messages | No | WhatsApp (Baileys) | cloud, hybrid |
| `whatsapp.contact_send` | Message WhatsApp contacts | Text a contact/phone (user must ask) | Yes | WhatsApp (Baileys) | cloud, hybrid |
| `whatsapp.auto_reply` | Auto-reply to contacts | After send, route that contact’s replies into a new run and deliver the answer back | No | WhatsApp (Baileys) | cloud, hybrid |
| `mcp.<slug>.<tool>` | MCP tool | One tool on a registered MCP server | Per tool (`auto` / `jit` / `blocked`) | MCP server | cloud (HTTP), hybrid (HTTP + stdio) |
| `mcp.<slug>.*` | MCP server wildcard | All tools on that server | If listed in JIT scopes | MCP server | same |

**Notes**
- Hybrid-only scopes (`system.file_*`, `system.gui_control`) force the agent onto a hybrid (or local) runtime.
- Team delegated scopes cannot exceed the agent’s own `permissionScopes`.
- `finance.spend_*` and `web.transaction` are first-class scopes with JIT; dedicated spend tool bindings are still evolving.

---

## 2. Tool groups

The intent router groups tools by required scopes:

| Group | Required scopes (any of) | Runtime |
|-------|--------------------------|---------|
| `research` | `web.research` | cloud, hybrid |
| `web` | `web.read`, `web.click`, `web.transaction` | cloud |
| `files` | `system.file_read`, `system.file_write` | hybrid |
| `code` | `system.file_read` | hybrid |
| `gui` | `system.gui_control` | hybrid |
| `comms` | `email.read`, `email.send`, `whatsapp.send`, `whatsapp.read`, `whatsapp.contact_send`, `whatsapp.auto_reply` | cloud, hybrid |
| `knowledge` | `brain.query`, `brain.knowledge_read` | cloud, hybrid |
| `always` | (none) | cloud, hybrid |

---

## 3. Built-in tools

### 3.1 Browser automation

**Scopes:** `web.read`, `web.click` (and `web.transaction` for form/checkout intent)  
**Engine:** agent-browser CLI (`browser_ab_*`)

| Tool | Purpose |
|------|---------|
| `browser_ab_open` | Navigate to a URL |
| `browser_ab_snapshot` | Accessibility tree + element refs |
| `browser_ab_click` / `_dblclick` | Click / double-click |
| `browser_ab_type` / `_fill` | Type into fields (append / clear-then-fill) |
| `browser_ab_press` | Keyboard key |
| `browser_ab_hover` / `_focus` | Hover / focus |
| `browser_ab_check` / `_uncheck` / `_select` | Forms controls |
| `browser_ab_drag` | Drag and drop |
| `browser_ab_upload` / `_download` | File upload / download |
| `browser_ab_scroll` / `_scrollintoview` | Scroll |
| `browser_ab_wait` | Wait for condition / timeout |
| `browser_ab_screenshot` / `_pdf` | Capture page |
| `browser_ab_eval` | Evaluate JS in page |
| `browser_ab_find` / `_get` / `_is` | Query elements / state |
| `browser_ab_back` / `_forward` / `_reload` | History / reload |
| `browser_ab_mouse` | Low-level mouse |
| `browser_ab_set` | Set viewport / options |
| `browser_ab_network` | Network inspection |
| `browser_ab_tab` | Tab management |
| `browser_ab_console` / `_errors` | Console / error logs |
| `browser_ab_highlight` | Highlight element |
| `browser_ab_cookies` / `_storage` | Cookies / storage |
| `browser_ab_trace` / `_record` | Trace / record session |
| `browser_ab_session` / `_connect` / `_close` | Session lifecycle |
| `browser_exec` | Raw agent-browser CLI passthrough |

Legacy activity aliases may appear in the UI: `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_extract`, `browser_axtree`.

---

### 3.2 Web research (platform APIs)

**Scope:** `web.research`  
No full browser — structured CLIs / APIs for search and content.

| Tool | Purpose |
|------|---------|
| `research_web_search` | Semantic web search |
| `research_read_url` | Read a URL as text |
| `research_social_search` | Twitter / Reddit / Xiaohongshu |
| `research_video` | YouTube / Bilibili metadata + subtitles |
| `research_github` | GitHub search or repo view |
| `create_report_pdf` | Render a Markdown report to PDF (+ download link) |
| `create_xlsx` | Generate a spreadsheet (+ download link) |

---

### 3.3 Email

**Scopes:** `email.read`, `email.send` · **Connector:** Google (Gmail)

| Tool | Scope | Notes |
|------|-------|-------|
| `email_read` | `email.read` | Search / fetch messages |
| `email_send` | `email.send` | JIT; conversation-scoped grant after first approve; subject to lead-outreach gates when used for campaigns |

---

### 3.4 WhatsApp

**Scopes:** `whatsapp.send` (self files), `whatsapp.read` (contacts + chats), `whatsapp.contact_send` (message contacts, JIT), `whatsapp.auto_reply` (listen after send)

| Tool | Notes |
|------|-------|
| `whatsapp_send` | Send a file to the linked WhatsApp **self-chat** |
| `whatsapp_list_contacts` | Search phonebook contacts by name/phone |
| `whatsapp_read_chat` | Read recent 1:1 messages with a contact (only when user asks) |
| `whatsapp_send_message` | Text a contact/phone (only when user explicitly asks; JIT). With `whatsapp.auto_reply`, arms a 24h listener for that contact. Optional `reply_instructions` stored on the session |
| `whatsapp_auto_reply_status` | List active auto-reply listeners for this agent |
| `whatsapp_auto_reply_stop` | Stop listening for one contact (or all) |
| `whatsapp_auto_reply_set_instructions` | Set/update what to do when that contact replies |
| `luna_local_send_whatsapp_document` | Hybrid: deliver a local file to self-chat; needs `system.file_read` **or** `system.file_write` |

**Auto-reply flow:** contact replies are forwarded only when an active session exists for that JID → new agent run (prompt includes stored `replyInstructions` when set) → final result is sent back to the same contact (not self-chat).

---

### 3.5 Local files & code (hybrid)

**Scopes:** `system.file_read`, `system.file_write`

| Tool | Scope | Purpose |
|------|-------|---------|
| `luna_local_read_file` | `file_read` | Read a local file |
| `luna_local_list_dir` | `file_read` | List a directory |
| `luna_local_open_file` | `file_read` | Open a file on the desktop |
| `luna_local_write_file` | `file_write` | Write a text file |
| `luna_local_bash` | `file_write` | Run a shell command |
| `luna_local_python` | `file_write` | Run Python |
| `luna_local_code_task` | `file_write` | Higher-level code task |
| `luna_local_create_pdf` | `file_write` | Generate a PDF |
| `luna_local_create_xlsx` | `file_write` | Generate a spreadsheet |

An older Luna hybrid surface also maps tools such as `file_read`, `file_write`, `apply_patch`, `git_*`, `shell_exec`, `code_interpreter`, `http_request`, and `web_search` — prefer the `luna_local_*` tools on current hybrid runners.

---

### 3.6 Desktop GUI (hybrid)

**Scope:** `system.gui_control` · **JIT:** yes

| Tool | Purpose |
|------|---------|
| `gui_control` | Screen automation — open apps, click, type, screenshot on the user’s machine |

---

### 3.7 AI Brain / knowledge

**Scopes:** `brain.query`, `brain.knowledge_read`

| Tool | Scope | Purpose |
|------|-------|---------|
| `brain_query` | `brain.query` | Query the org AI brain (policies, knowledge, insights) |

Org brain agents are also provisioned with `brain.knowledge_read` for indexed document access.

---

### 3.8 Meta tools (always available)

| Tool | Purpose |
|------|---------|
| `think` | Internal reasoning step (no external side effect) |
| `done` | Signal that the task is complete |
| `spawn_subagents` | Parent-only: spawn N nested sub-agents (opt-in `QLIX_ENABLE_SUBAGENTS`) |
| `await_subagents` | Wait for spawned sub-agent results |
| `delegate_task` | Legacy fire-and-forget child run (opt-in `QLIX_ENABLE_DELEGATION`; prefer sub-agents) |

See [sub-agents.md](./sub-agents.md) for V1 nested execution and V2 identity promotion.

---

## 4. MCP tools

MCP servers are registered per org and bound to agents. Each tool is exposed as scope `mcp.<slug>.<tool>` (runtime name often `mcp__<slug>__<tool>`). Governance defaults: read-only → `auto`; mutating → `jit`; can be set to `blocked`.

### 4.1 First-party — Qlix Jobs (job apply)

**Server:** `qlix-jobs` · Endpoint `/mcp-jobs` · Greenhouse / Lever / Ashby only (LinkedIn/Indeed rejected).

Granted as normal agent scopes (`mcp.qlix-jobs.*`) via AI Builder or the agent scope picker — not a separate console app. Pair with `web.read` + `web.click` + `web.transaction` (JIT on submit).

| Tool | Purpose | Constraints |
|------|---------|-------------|
| `upsert_candidate_profile` | Update profile fields / answer bank | |
| `stage_resume` | Stage resume text or base64 for upload | Call before queue |
| `search_jobs` | Public ATS board APIs | `ats` + `board` required |
| `queue_applications` | Create campaign + queue apply URLs | Needs staged resume |
| `list_applications` | List campaign applications | |
| `get_apply_brief` | Profile + resume URL + ATS playbook | Marks app `filling` |
| `record_application_result` | `awaiting_jit` / `submitted` / `blocked` / … | After each attempt |

Typical flow (AI Builder: “create an agent that applies to jobs with my resume”): stage_resume → upsert profile → queue_applications → get_apply_brief → `browser_ab_*` fill + upload → record awaiting_jit → **JIT `web.transaction`** → submit → record submitted.

### 4.2 First-party — Qlix Schedule (cron / once / interval)

**Server:** `qlix-schedule` · Endpoint `/mcp-schedule` · Persists `ScheduledEvent` rows; backend ticks every ~1 minute and enqueues the prompt as an agent run.

**Always-on:** every standard agent is granted `brain.query` and all `mcp.qlix-schedule.*` tools at create/update (and backfilled on boot), regardless of other scopes or NL intent. AI Brain (exa) schedules jobs **on itself by default** via in-process `schedule_create` / `schedule_list` / `schedule_cancel`; it only targets another agent when the user explicitly names that agent.

| Tool | Purpose | Constraints |
|------|---------|-------------|
| `schedule_create` | Create cron / once / interval event | Agents may only target themselves; cron is 5-field UTC |
| `schedule_list` | List schedules for the agent | |
| `schedule_get` | Get one schedule by id | |
| `schedule_update` | Pause / resume / edit prompt or timing | |
| `schedule_cancel` | Soft-cancel (never fires again) | Destructive |

Console API: `GET/POST /api/v1/schedules` (user auth). Internal: `/api/v1/internal/schedules` (service secret).

### 4.3 Catalog integrations (operator-registered)

Templates in the MCP catalog (tools vary by server; scopes are generated per tool):

| Id | Category | What it enables |
|----|----------|-----------------|
| `qlix-jobs` | Data | Job Apply Copilot (above) |
| `qlix-schedule` | Automation | Cron / once / interval agent runs (above) |
| `github` | Dev | Issues, PRs, code & repo search |
| `google-workspace` | Productivity | Gmail, Calendar, Drive, Docs, Sheets (via Workspace MCP) |
| `slack` | Comms | Read channels / post as bot (hybrid stdio) |
| `linear` | Productivity | Issues, projects, cycles |
| `notion` | Productivity | Search / read pages, append databases |
| `postgres` | Data | Read-only SQL |
| `filesystem` | Data | Read/write under an allow-listed path (hybrid) |

Custom MCP servers can also be registered; their tools appear as additional `mcp.*` scopes.

---

## 5. How tools are authorized & audited

1. **Identity** — Agent DID + Ed25519 keypair; Verifiable Credentials carry identity, scope, and JIT claims (Layer 3).
2. **JIT** — Scopes marked `forceJit` (or MCP `jit`) request human approval; agent polls for a `jitToken`.
3. **Action ledger** — `POST /api/v1/actions/start` → execute → `POST /api/v1/actions/complete` (signed; Layer 5).
4. **Audit UI** — Events bucketed as READ / WRITE / AUTH; results Success / Blocked / Flagged.

Supporting agent APIs (non-exhaustive): run poll / events / complete, email & WhatsApp tool proxies, brain query, MCP proxy call, heartbeat (`ping`), report-PDF upload.

---

## 6. Quick reference — scope → tools

| Scope | Primary tools |
|-------|----------------|
| `web.read` / `web.click` | `browser_ab_*`, `browser_exec` |
| `web.research` | `research_*`, `create_report_pdf`, `create_xlsx` |
| `web.transaction` | Form/checkout intent (JIT); used with browser tools |
| `system.file_read` | `luna_local_read_file`, `luna_local_list_dir`, `luna_local_open_file` |
| `system.file_write` | `luna_local_write_file`, `luna_local_bash`, `luna_local_python`, `luna_local_code_task`, `luna_local_create_pdf`, `luna_local_create_xlsx` |
| `system.gui_control` | `gui_control` |
| `email.read` / `email.send` | `email_read`, `email_send` |
| `whatsapp.send` | `whatsapp_send` (+ `luna_local_send_whatsapp_document` with file scopes) |
| `social.read` | Orbit channels / posts / analytics (via Connectors → Orbit) |
| `social.publish` | Orbit create/schedule post (JIT; via Connectors → Orbit) |
| `brain.query` | `brain_query` (always-on for every standard agent) |
| `brain.knowledge_read` | Org knowledge access (brain agent) |
| `finance.spend_*` | Spend authorization (JIT) |
| `mcp.qlix-jobs.*` | Job apply tools in §4.1 |
| `mcp.qlix-schedule.*` | Schedule tools in §4.2 |
| `mcp.<slug>.*` | Tools from that MCP server |
| *(always)* | `think`, `done` |

---

## Related docs

- Product / IA overview: [AGENTS.md](./AGENTS.md)
- Repo setup: [README.md](./README.md)
- Scope catalog (code): `backend/src/agents/scopeCatalog.ts`
- Python SDK: `sdk/python/`
- Leads MCP: `qlix-mcp-service/`
