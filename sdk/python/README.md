# qlix (Python SDK)

Signed, audited tool execution for AI agents. Wraps Luna tool calls with
Ed25519 signatures, a backend-verified pre-log (`/actions/start`), real
execution, and a signed completion log (`/actions/complete`). Pay-per-success
billing happens server-side on the completion call.

## Install

```bash
cd sdk/python
pip install -e .
```

## Credentials (`agent.json`)

After creating an agent, **download** `agent.json` from the console (the API returns
**`sdkAgentFile`** on `POST /api/v1/agents`). Save it **anywhere** on disk.

Point the SDK at that file with the environment variable **`QLIX_AGENT_FILE`**:

```bash
# Linux / macOS
export QLIX_AGENT_FILE=/absolute/path/to/my-agent.json

# Windows CMD
set QLIX_AGENT_FILE=C:\absolute\path\to\my-agent.json

# Windows PowerShell
$env:QLIX_AGENT_FILE="C:\absolute\path\to\my-agent.json"
```

Or pass an explicit path: **`QlixSDK(agent_file="/path/to/agent.json")`**.

Optional: **`save_sdk_agent_json("/tmp/agent.json", extract_sdk_agent_file(api_body))`**
after copying the create-agent JSON response.

## Use

```python
import asyncio
from qlix import QlixSDK

async def main():
    async with QlixSDK() as sdk:
        async def execute():
            return {"status": 200, "url": "https://example.com"}

        result = await sdk.run(
            action_type="web.fetch",
            payload={"url": "https://example.com"},
            execute_fn=execute,
            risk_level="low",
        )
        print(result)

asyncio.run(main())
```

`sdk.run(...)`:

1. Checks the action is in `permission_scopes` — else `ScopeError`, no execution.
2. If the action is in `jit_scopes`, blocks on user approval (`PermissionDeniedError` on deny, `JITTimeoutError` after 120s).
3. Signs and POSTs `/api/v1/actions/start` → backend verifies → returns `action_id`.
4. Runs `execute_fn()`.
5. POSTs `/api/v1/actions/complete` with success+result OR success=false+error.
   Backend debits the wallet on success only.
6. Returns the original result, or re-raises the original exception.

## Layers

| File              | Responsibility                                              |
| ----------------- | ----------------------------------------------------------- |
| `identity.py`     | Loads + validates `agent.json`. DID, keys, scopes.          |
| `signer.py`       | Canonical JSON + Ed25519 sign/verify. Matches backend exactly. |
| `http_client.py`  | Async httpx wrapper, retries, typed error mapping.          |
| `jit.py`          | JIT request + polling (`/api/v1/jit/request`, `/poll/:id`). |
| `sdk.py`          | `QlixSDK.run()` — orchestrates the full lifecycle.          |
| `exceptions.py`   | Typed errors (`ScopeError`, `PermissionDeniedError`, …).    |

## Wire format

Every signed request body looks like:

```json
{
  "signature": "<hex ed25519>",
  "signedPayload": { "did": "...", "actionType": "...", "timestampMs": 0, ... }
}
```

Canonicalization (must byte-match backend `canonicalize()` in
`backend/src/actions/canonical.ts`):

- object keys sorted lexicographically at every depth
- arrays preserve order
- no whitespace between tokens (`separators=(',', ':')`)
- raw unicode preserved (`ensure_ascii=False`)
- `None` / `undefined` keys dropped

## License

Qlix SDK is distributed under the **Elastic License 2.0** (ELv2). You can use,
copy, modify, and distribute it freely. The two key restrictions:

1. You may not offer Qlix as a hosted/managed service to third parties.
2. You may not remove or circumvent the agent identity / DID verification.

The bundled `qlix.luna` runtime requires a valid `agent.json` (with a DID
registered on the Qlix backend) before any tool will execute. Installing the
package is free; running agents through it requires a Qlix-issued identity.

See [LICENSE](./LICENSE) for the full text.
