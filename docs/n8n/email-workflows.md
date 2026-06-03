# n8n email workflows for Qlix

Qlix agents call `email_read` / `email_send` tools in cloud runners. The Qlix backend refreshes Google OAuth tokens from **Connectors**, then POSTs to your self-hosted n8n webhooks with a Bearer secret configured in the Connectors UI.

## Prerequisites

1. Self-hosted n8n with **public HTTPS** URLs
2. Qlix Connectors: Google OAuth connected
3. Qlix Connectors: n8n base URL + webhook secret saved (org admin)

Default webhook paths (configurable in Qlix):

| Workflow | Default path |
|----------|----------------|
| Read | `/webhook/qlix-email-read` |
| Send | `/webhook/qlix-email-send` |

## Authentication

Both workflows use **Header Auth**:

```
Authorization: Bearer <N8N_WEBHOOK_SECRET>
```

Use the same secret you enter in Qlix Connectors → n8n integration.

---

## Workflow A: `qlix-email-read`

**Trigger:** Webhook (POST)

**Request body (from Qlix):**

```json
{
  "accessToken": "<google_access_token>",
  "query": "is:unread",
  "maxResults": 10,
  "messageId": null
}
```

**Logic:**

1. If `messageId` is set → Gmail API `users.messages.get`
2. Else → Gmail API `users.messages.list` with `q=query`, then batch get messages
3. Normalize each message: `id`, `threadId`, `from`, `to[]`, `subject`, `snippet`, `bodyText`, `receivedAt`
4. Truncate `bodyText` to ~32KB; strip HTML if needed

**Response:**

```json
{
  "messages": [
    {
      "id": "18abc...",
      "threadId": "18def...",
      "from": "alice@example.com",
      "to": ["you@example.com"],
      "subject": "Hello",
      "snippet": "Preview…",
      "bodyText": "Full plain text…",
      "receivedAt": "2026-05-27T10:00:00Z"
    }
  ]
}
```

### Example n8n nodes

1. **Webhook** — POST, authentication Header Auth
2. **IF** — `{{ $json.messageId }}` is not empty
3. **HTTP Request (get one)** — `GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{{ $json.messageId }}?format=full` with `Authorization: Bearer {{ $json.accessToken }}`
4. **HTTP Request (list)** — `GET .../messages?q={{ encodeURIComponent($json.query) }}&maxResults={{ $json.maxResults }}`
5. **Code** — parse MIME, build `messages` array
6. **Respond to Webhook** — return JSON

---

## Workflow B: `qlix-email-send`

**Trigger:** Webhook (POST)

**Request body:**

```json
{
  "accessToken": "<google_access_token>",
  "to": ["recipient@example.com"],
  "subject": "Re: Support request",
  "bodyText": "Plain text body",
  "replyToMessageId": null
}
```

**Logic:**

1. Build RFC822 raw message (base64url) or use n8n Gmail node with OAuth disabled (token in header)
2. If `replyToMessageId` set, fetch thread id and set `In-Reply-To` / `References` headers
3. POST to Gmail `users.messages.send`

**Response:**

```json
{
  "messageId": "18abc...",
  "threadId": "18def...",
  "status": "sent"
}
```

---

## Manual test (curl)

Replace placeholders:

```bash
curl -X POST "https://n8n.example.com/webhook/qlix-email-read" \
  -H "Authorization: Bearer YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"accessToken":"ya29....","query":"is:unread","maxResults":5,"messageId":null}'
```

---

## Security notes

- Never log full `accessToken` in n8n execution logs in production
- Restrict n8n webhook URLs to Qlix backend egress IPs if possible
- Rotate webhook secret via Qlix Connectors UI periodically
