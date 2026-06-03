Here is a concise how it works plus how to test it and what you should see, starting from agent creation.

How the pipeline fits together
Create agent (HTTP) — POST /api/v1/agents with a logged-in user JWT, a valid X-Qlix-Device-Step-Up token (WebAuthn step-up), and a JSON body (name, permissionScopes, jitScopes, runtime, model, orgId, …). The backend generates a DID, Ed25519 keypair, stores the agent, returns agent (including privateKey once) and VCs.

agent.json (SDK) — You copy fields from that response into a file the SDK can load. For await sdk.start("<name>") the path is ~/.qlix/agents/<name>/agent.json. The loader expects (names per 86:139:d:\ysw\qlix\sdk\python\qlix\identity.py): did, agent_id, private_key / public_key (64-char hex), scope arrays, optional backend_url / camelCase equivalents.

Signed actions — QlixSDK.run() or QlixToolExecutor signs payloads with sign_payload → canonicalize so they match backend/src/actions/canonical.ts. Calls POST /api/v1/actions/start then POST /api/v1/actions/complete.

JIT — For scopes in jit_scopes, the SDK calls POST /api/v1/jit/request and polls GET /api/v1/jit/poll/:id. After approval it sends jitToken inside the /actions/start signed payload; the server consumes that token.

Billing / audit — Append-only action_logs; on successful complete for an org agent, the backend can debit wallet and record billing (existing ActionsService.complete logic).

What you need running
Piece	Role
PostgreSQL
Stores agents, actions, approvals, wallets
Backend (backend)
API + Prisma; apply migrations (including jit_token on approvals)
QLIX_BACKEND_URL (or backend_url in JSON)
Must point at that API (e.g. http://localhost:8080) — no trailing path
Python SDK
pip install -e sdk/python (+ OpenJarvis extras if you use start())
Phase 1 — Create an agent (API)
Requirements

Bearer JWT (authenticateUser).
Header X-Qlix-Device-Step-Up: <token> — from your WebAuthn step-up flow after device verification (see 56:79:d:\ysw\qlix\backend\src\routes\createAgentsRouter.ts). Without it you get 403 step_up_required or step_up_invalid_or_expired.
Example body (scopes must be from the enum in 1:18:d:\ysw\qlix\backend\src\agents\agents.types.ts):

{
  "name": "test-agent",
  "permissionScopes": ["web.read", "web.click"],
  "jitScopes": [],
  "runtime": "cloud",
  "model": "claude-sonnet-4-6",
  "orgId": null,
  "localInferenceMode": null
}
What to expect

201 with agent (includes privateKey — treat as secret) and credentials (VCs).
403 device_not_verified if the user’s account isn’t in the state createAgent expects.
403 org errors if orgId doesn’t match membership.
Build agent.json for the SDK (map API → file; use your real API base as backend_url):

{
  "did": "<agent.did from response>",
  "agent_id": "<agent.id>",
  "private_key": "<agent.privateKey lowercase hex>",
  "public_key": "<agent.publicKey lowercase hex>",
  "permission_scopes": ["web.read", "web.click"],
  "jit_scopes": [],
  "always_scopes": ["web.read", "web.click"],
  "backend_url": "http://localhost:8080"
}
Use always_scopes = scopes that are not JIT (the backend splits JIT vs always internally; your exported VC/agent row includes alwaysScopes — you can copy agent.alwaysScopes from the 201 response if present).

Save as e.g. %USERPROFILE%\.qlix\agents\test-agent\agent.json (folder agents\<name>\ matches await sdk.start("test-agent")).

Phase 2 — Smoke-test actions only (no OpenJarvis)
Install SDK, set backend_url, then:

import asyncio
from qlix import QlixSDK
async def main():
    async with QlixSDK() as sdk:  # or agent_file=r"C:\Users\you\.qlix\agents\test-agent\agent.json"
        async def work():
            return {"ok": True}
        out = await sdk.run(
            action_type="web.read",
            payload={"probe": True},
            execute_fn=work,
            risk_level="low",
        )
        print("result", out)
asyncio.run(main())
What to expect

Success: out is {"ok": True}; backend has two action_logs rows for this agent (start phase + :complete), signatures verified.
ScopeError: action_type not in permission_scopes in the JSON.
HttpError / 401 / 403: wrong keys, clock skew, unknown DID, or invalid signature.
ReplayError-style behaviour if server thinks timestampMs is stale (±5 minutes in ActionsService).
Org billing: if the agent has orgId, a successful complete may debit the org wallet and write billing artifacts; with orgId: null, the wallet path in complete is skipped for that agent.

Phase 3 — JIT path
Create an agent (or edit JSON) with jitScopes including an action you will test, e.g. finance.spend_50, and ensure permissionScopes also includes that scope.

For local dev without a human approver, run the backend with:

QLIX_JIT_AUTO_APPROVE=1

so POST /jit/request immediately mints an approval + jitToken (see JIT service).

Run sdk.run(action_type="finance.spend_50", ...) (or a tool that maps to that scope).

What to expect

SDK: POST /api/v1/jit/request → jitRequestId, then polls until approved + jitToken, then /actions/start includes jitToken, then /actions/complete.
Without auto-approve: poll stays pending until something sets approval (your future dashboard flow); then timeout after ~120s → JITTimeoutError in Python.
Phase 4 — await sdk.start("test-agent") (full OpenJarvis)
This imports the bundled engine and needs OpenJarvis’s runtime dependencies (click, httpx, openai, …), not only httpx + cryptography.

What to expect

IdentityError if ~/.qlix\agents\test-agent\agent.json is missing or invalid.
After success: a JarvisSystem with tool_executor wrapped by QlixToolExecutor, so tool calls go through JIT + start + complete when they go through that executor.
Engine/model errors if ~/.openjarvis config / Ollama / API keys aren’t set — that’s OpenJarvis config, not Qlix identity.
Quick backend checks (optional)
Check	How
Agent exists
GET /api/v1/agents with JWT
Action rows
DB action_logs for your agent_id
JIT row
approvals linked to action_logs for JIT request; jit_token set when approved
README drift
sdk/python/README.md still says JIT endpoints are “WIP” and OpenJarvis bundling is manual — you’ve since added JIT routes, start(agent_name), and bundled qlix.openjarvis. Worth updating that file when you want docs to match reality.

Short summary
From “create agent” onward, you validate in order: (1) API create + step-up → (2) write ~/.qlix/agents/<name>/agent.json → (3) QlixSDK.run() for a scope you granted → (4) optional JIT with QLIX_JIT_AUTO_APPROVE → (5) optional await sdk.start(name) once OpenJarvis deps and runtime are configured. Expect typed Python errors for scope/signature/time, HTTP errors for backend rejection, and DB/ledger changes when calls succeed and (for org agents) billing applies.