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
| POST | `/send` | `{ connector_id, message }` |
| POST | `/send-approval` | `{ connector_id, action_id, … }` |
| POST | `/send-notification` | `{ connector_id, message, level }` |

## Hybrid + AI brain (agent chat from WhatsApp)

Message your linked number:

```
@local #brain: Follow company playbook. Read C:\path\to\AgentDebug.log on my PC, open it in Notepad, summarize errors.
```

- `#brain` — enables org AI brain for that run (agent needs `brain.query` scope).
- Hybrid agents run tools on the PC (`s3_read_file`, `s3_open_file`, etc.); results are sent back to WhatsApp when the run completes.

See [docs/e2e/hybrid-whatsapp-brain-field-support.md](../docs/e2e/hybrid-whatsapp-brain-field-support.md).

## Limitations

- Mentioning WhatsApp in a team goal or agent chat prompt triggers delivery of the final result after the run completes (team or agent chat), in addition to inbound-run notifications.
- Unofficial WhatsApp Web (Baileys) — account risk, session expiry
- One WhatsApp per workspace (org or individual)
- Scale: RAM per active session; plan horizontal sharding by connectorId later
