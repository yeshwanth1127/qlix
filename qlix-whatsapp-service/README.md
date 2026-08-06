# Qlix WhatsApp Service

Multi-tenant Baileys sidecar for Qlix. Each **workspace** (individual or organization) links its own WhatsApp via **Connectors** in the dashboard.

## Platform setup (once per deployment)

```bash
cd qlix-whatsapp-service
npm install
cp .env.example .env
```

```env
PORT=3939
QLIX_URL=http://localhost:4000
SERVICE_SECRET=<same as QLIX_INTERNAL_SERVICE_SECRET>
NODE_ENV=development
# Baileys internal logs default to silent. Set BAILEYS_LOG_LEVEL=debug only when debugging wire protocol.
# BAILEYS_LOG_LEVEL=silent
```

```bash
npm start
```

Backend `.env`:

```env
QLIX_WHATSAPP_ENABLED=1
QLIX_WHATSAPP_SERVICE_URL=http://localhost:3939
QLIX_INTERNAL_SERVICE_SECRET=<shared secret>
```

Run DB migration: `npx prisma migrate deploy` in `backend/`.

## QR linking requirements (do not regress)

WhatsApp Web changes frequently. **Baileys must use `fetchLatestBaileysVersion()`** when creating sockets — without it, pairing fails with HTTP 405 and **no QR is ever emitted** (Connectors shows “Generating QR…” forever).

Safeguards in this service:

- **Startup:** `ensureBaileysVersionReady()` — process exits if version lookup fails
- **`GET /health`:** returns `qr_linking_ready`, `baileys_version`, `baileys_version_ok` (503 when not ready)
- **Reconnect:** on 405 disconnect, version cache is invalidated and refreshed
- **Tests:** `npm test` in this directory

If QR linking breaks after a Baileys upgrade, verify `/health` shows `baileys_version_ok: true`.

## Customer flow (SaaS)

1. User opens **Connectors** (`/individual/connectors` or `/organization/connectors`).
2. Clicks **Link WhatsApp** → QR appears.
3. Scans with WhatsApp → Linked devices.
4. Status shows **Connected** with phone number.

That workspace’s agents use this number for:

- JIT approval messages (yes/no)
- Inbound commands and agent runs
- Run completion notifications

## Per-tenant sessions

- Session files: `auth_info/<connectorId>/`
- One Baileys socket per linked `connector_accounts` row
- Inbound messages routed by owner JID → connector → org/user

## API (service secret)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/sessions/:connectorId/start` | Start / resume session |
| GET | `/sessions/:connectorId/status` | `{ connected, qr, ownerJid }` |
| DELETE | `/sessions/:connectorId` | Logout + wipe session |
| POST | `/send` | `{ connector_id, message }` — self-chat only |
| POST | `/send-to` | `{ connector_id, recipient, message }` — contact / phone |
| POST | `/contacts/list` | `{ connector_id, query?, limit? }` |
| POST | `/chats/messages` | `{ connector_id, recipient, limit? }` |
| POST | `/send-approval` | `{ connector_id, action_id, … }` |
| POST | `/send-notification` | `{ connector_id, message, level }` |

## Agent chat from WhatsApp (intent routing)

In **Message yourself** on the linked WhatsApp account, send plain text — no `@AgentName` needed:

```
#brain Follow our field support playbook. Read C:\path\to\AgentDebug.log on my PC, open it in Notepad, and summarize errors.
```

- Qlix **intent routing** picks the best agent from descriptions, scopes, and online status.
- `#brain` — enables org AI brain for that run (agent needs `brain.query` scope).
- `@TeamName: goal` — run a multi-agent team instead of a single agent.
- Hybrid agents run tools on the PC; results are sent back to WhatsApp when the run completes.

See [docs/e2e/hybrid-whatsapp-brain-field-support.md](../docs/e2e/hybrid-whatsapp-brain-field-support.md).

## Limitations

- Mentioning WhatsApp in a team goal or agent chat prompt triggers delivery of the final result after the run completes (team or agent chat), in addition to inbound-run notifications.
- Unofficial WhatsApp Web (Baileys) — account risk, session expiry
- One WhatsApp per workspace (org or individual)
- Scale: RAM per active session; plan horizontal sharding by connectorId later
