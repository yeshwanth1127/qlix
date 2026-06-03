# OpenRouter Proxy Smoke Test

## Required env

Set in `backend/.env`:

- `OPENROUTER_API_KEY=<your key>`
- Optional: `OPENROUTER_ALLOWED_MODEL_PREFIXES=openrouter/`

Restart backend after env change.

## Verify runner does not hold provider keys

```powershell
docker inspect qlix-agent-<agentId> --format "{{json .Config.Env}}"
```

Expected: contains `QLIX_*` variables only, no `OPENROUTER_API_KEY`.

## Verify backend proxy endpoint

Use a valid runner token for that agent:

```powershell
curl -X POST "http://localhost:4000/api/v1/agents/<agentId>/inference/chat" `
  -H "Content-Type: application/json" `
  -H "x-qlix-runner-token: <runnerToken>" `
  -d "{\"model\":\"openrouter/openai/gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello\"}]}"
```

Expected: JSON response with `content`, `finish_reason`, and `usage`.

## End-to-end chat check

1. Open agent chat UI.
2. Send a message.
3. Check backend logs for:
   - `[inference] stage=request ...`
   - `[inference] stage=success ...`
4. Verify response is model-generated (not echo).

