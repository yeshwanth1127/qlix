# Agent creation — implementation reference

This document describes the **current** end-to-end agent creation flow in the Qlix codebase: user experience, API contracts, authentication, cryptography, and data persistence. It is the source of truth for what is **implemented** (not a future design doc).

**Last aligned with repository layout:** `backend/src`, `frontend/src`, `prisma/schema.prisma`.

---

## 1. Trust model (summary)

| Role | What it proves |
|------|----------------|
| **Signed-in user** | Session cookie + JWT (`qlix_session`) — who is operating the console. |
| **Passkey enrollment** | User row has completed WebAuthn registration (`deviceVerified` + credential id + public key). |
| **Step-up (per create)** | Short-lived JWT in header `X-QLIX-Device-Step-Up` — a WebAuthn ceremony (registration or authentication) just succeeded for this user. |
| **Qlix platform** | Issues Verifiable Credentials (VCs) about the agent; signs with **platform Ed25519** key. Verifiers resolve platform public key via `/.well-known/did.json`. |
| **Agent** | Gets its own **DID** and **Ed25519 keypair**; private key returned once to the client for local/runtime use. Platform signs **credentials about** the agent, not day-to-day agent actions (those would use the agent key elsewhere). |

---

## 2. User-facing flow (wizard)

**Component:** `frontend/src/components/qlix/agents/CreateAgentModal.tsx`  
**List entry:** `AgentsListView` passes `orgId` (organization route) or `null` (individual), and `deviceVerified` from session (`session.user.deviceVerified`).

The modal shows **5 steps** plus a **result** screen (header labels result as “step 5 of 5” completed).

| Step | Purpose |
|------|--------|
| **1** | Agent **name** + **permission scopes** (multi-select). At least one scope required to proceed. |
| **2** | **JIT toggles** for scopes the user selected. Scopes in `FORCE_JIT_SCOPES` are **always JIT** and toggles are disabled (“platform required”). Optional JIT for other selected scopes. |
| **3** | **Runtime:** `cloud` or `local`. **Model** chosen from fixed lists (`CLOUD_MODELS` / `LOCAL_MODELS` in `frontend/src/lib/agents-api.ts`). Labels only — no live OpenRouter/Ollama API integration in this flow. |
| **4** | **Copy only:** explains that the next action will trigger WebAuthn (registration if no passkey yet, or passkey authentication if already enrolled). |
| **5** | **Submitting** UI while the client runs WebAuthn + `POST /agents`. |

**Footer:** From steps 1–4, **Next** advances; on step 4 the primary button is **“Verify & create”**, which moves to step 5 and starts **`submit()`**.

### 2.1 Client submit sequence (`submit()`)

1. Build JSON body: `name`, `permissionScopes`, **computed** `jitScopes` / underlying split matches server (`splitJit` uses `FORCE_JIT_SCOPES` + `userToggledJit`), `runtime`, `model`, `orgId`.

2. **Obtain step-up token**
   - If **`deviceVerified`** is false: **`registerDeviceWithError()`** — `POST /api/v1/webauthn/register/start` → `@simplewebauthn/browser` `startRegistration` → `POST .../register/verify`. Response must include **`deviceVerified: true`** and **`stepUpToken`**. Then **`refreshSession()`** so UI state matches server.
   - If **`deviceVerified`** is true: **`authenticateForAgentCreateWithError()`** — `POST .../authenticate/start` → `startAuthentication` → `POST .../authenticate/verify`. Response must include **`stepUpToken`**.

3. **`createAgent(body, stepUpToken)`** — `POST /api/v1/agents` with credentials (cookies), JSON body, and header **`X-QLIX-Device-Step-Up: <stepUpToken>`** (`DEVICE_STEP_UP_HEADER` in `agents-api.ts`).

4. On success: show **result** panel; optional **download** for local runtime calls **`confirmDownload(agent.id)`** after download.

**Important:** Step 4 does **not** call WebAuthn by itself. WebAuthn runs inside **`submit()`** when leaving step 4 via **Verify & create**. Users who already have a passkey still perform **authentication** (not skipped) to mint the step-up token.

---

## 3. HTTP API — create agent

**Route:** `POST /api/v1/agents`  
**Router:** `backend/src/routes/createAgentsRouter.ts`

### 3.1 Prerequisites

- **`authenticateUser(true)`** — valid session cookie; JWT payload attached as `request.auth` (`userId`, `orgId`, etc.).

### 3.2 Headers

| Header | Required | Meaning |
|--------|----------|---------|
| `Cookie` | Yes | Session JWT (`qlix_session`). |
| `X-QLIX-Device-Step-Up` | Yes | HS256 JWT minted after WebAuthn verify; TTL **`AGENT_CREATE_STEP_UP_TTL_SEC`** (300 seconds). Claims include `sub` = user id, `qlixStepUp` = `agent_create`. Verified with **`verifyAgentCreateStepUpToken`** in `backend/src/lib/authTokens.ts`. |

Missing or invalid step-up → **403** `step_up_required` or `step_up_invalid_or_expired`.

### 3.3 Body (Zod `createAgentSchema`)

| Field | Rules |
|-------|--------|
| `name` | Non-empty string, max 120 after trim. |
| `permissionScopes` | Non-empty array of allowed enum values (see §5). |
| `jitScopes` | Array of same enum (may be empty); server recomputes effective JIT via **`enforceJitRules`**. |
| `runtime` | `cloud` \| `local`. |
| `model` | Non-empty string, max 120. |
| `orgId` | UUID string or **`null`**. For org workspace, client sends org id; **`null`** for individual agents (agents tied to user, `orgId` null in DB). |

---

## 4. Backend orchestration (`AgentsService.createAgent`)

**File:** `backend/src/agents/agents.service.ts`

Order of operations:

1. **`assertDeviceVerified(userId)`** (via `AgentsRepository` → **`DeviceVerificationService.assertUserVerified`**)  
   Ensures enrollment is **complete**: `deviceVerified` **and** `webauthnCredentialId` **and** `webauthnPublicKey`. Otherwise **`DeviceNotVerifiedError`** → HTTP 403 `device_not_verified`.

2. **`assertOrgMembership(userId, input.orgId)`**  
   If `orgId` is non-null, user’s `orgId` must match. Otherwise **`OrgMembershipError`** → 403.

3. **`enforceJitRules(permissionScopes, jitScopes)`** (`backend/src/agents/jit.ts`)  
   Computes final **`jitScopes`** and **`alwaysScopes`** stored on the agent. Server is authoritative.

4. **`generateDID()`** (`backend/src/agents/did.ts`)  
   Format: `did:qlix:` + 16 hex chars (8 random bytes).

5. **`generateKeypair()`** (`backend/src/agents/keypair.ts`)  
   Ed25519 via `@noble/ed25519`; **hex** strings for `publicKey` / `privateKey`.

6. **`repo.createAgent(...)`** — Prisma insert; persists **`webauthnCredentialId`** from the **user** at creation time.

7. **`CredentialsService.issueAgentVCs(...)`** — two VC rows (identity + scope); see §7.

8. Return **`agent`** DTO plus **`privateKey`** (only in this response for the client).

---

## 5. Permission scopes and JIT

**Types:** `backend/src/agents/agents.types.ts` and mirrored in `frontend/src/lib/agents-api.ts`.

Allowed scopes:

- `web.read`, `web.click`, `web.transaction`
- `system.file_read`, `system.file_write`
- `finance.spend_50`, `finance.spend_100`

**Forced JIT** (`FORCE_JIT_SCOPES` / `jit.ts`):

- `web.transaction`, `system.file_write`, `finance.spend_50`, `finance.spend_100`

**Rule:** A scope in `permissionScopes` lands in **`jitScopes`** if it is forced JIT **or** the client listed it in `jitScopes`. Remaining selected scopes become **`alwaysScopes`**.

Runtime enforcement (blocking actions until human approval) is **product scope beyond** this document; the DB and VC **record** the split.

---

## 6. WebAuthn

**Service:** `backend/src/webauthn/webauthn.service.ts`  
**Routes:** `backend/src/routes/createWebauthnRouter.ts`

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/v1/webauthn/register/start` | Session | Registration options; challenge stored in memory (per user). |
| `POST /api/v1/webauthn/register/verify` | Session | Verifies attestation; updates user `webauthnCredentialId`, `webauthnPublicKey`, `webauthnCounter`, `deviceVerified`. Returns **`deviceVerified: true`** + **`stepUpToken`**. |
| `POST /api/v1/webauthn/authenticate/start` | Session | Assertion options; separate challenge store from registration. |
| `POST /api/v1/webauthn/authenticate/verify` | Session | Verifies assertion; updates counter. Returns **`ok: true`** + **`stepUpToken`**. |

**Config:** `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` / `WEBAUTHN_ORIGINS`, `FRONTEND_URL` — see `backend/src/config/loadEnvironmentConfig.ts`. Loopback variants (`localhost` / `127.0.0.1`) are expanded for `expectedOrigins` when relevant.

**Challenge stores:** in-memory `Map`s — **not** suitable for multi-instance production without Redis or similar.

---

## 7. Verifiable Credentials (VC engine)

**Service:** `backend/src/credentials/credentials.service.ts`  
**Repository:** `backend/src/credentials/credentials.repository.ts`  
**Types:** `backend/src/credentials/vc.types.ts`

On create, **`issueAgentVCs`** issues exactly **two** credentials:

1. **`type: identity`** — claims include `humanVerified`, `deviceVerified`, `webauthnCredentialId`, `issuedBy` (platform DID from env).
2. **`type: scope`** — claims include `permissionScopes`, `jitScopes`, `alwaysScopes`.

**Signing:**

- Payload object: `{ issuer, subject, type, claims, issuedAt }` with deterministic **`canonicalize()`** (sorted object keys; arrays keep order) — **not** raw `JSON.stringify` of arbitrary object order.
- Signature: **`signAction`** from `keypair.ts` using **`getPlatformIdentity().privateKeyHex`** (Ed25519).
- Persisted: `verifiable_credentials` table — `claims`, `signature`, `issuerDid`, `subjectDid`, etc.

**Platform identity:** `backend/src/credentials/platformIdentity.ts`  
Requires **`QLIX_PLATFORM_DID`** and **`QLIX_PLATFORM_PRIVATE_KEY`** (64 hex chars = 32 bytes). Validated at startup in **`loadEnvironmentConfig`**. Public key derived for `/.well-known/did.json`.

---

## 8. Database (Prisma)

**Agent** (`prisma/schema.prisma`): `id` (cuid), `userId`, optional `orgId`, `name`, `did` (unique), `publicKey`, `status`, `runtime`, `llmModel` (mapped column `model`), string arrays for scopes, optional `webauthnCredentialId`, `keypairDeliveredAt`, `lastConnectedAt`, timestamps.

**VerifiableCredential:** linked to `agentId`; stores VC metadata + JSON `claims` + hex `signature`.

**User:** WebAuthn fields used for enrollment and **`sessionUserPayload`** `deviceVerified` derivation.

---

## 9. Related endpoints (after creation)

| Method | Path | Notes |
|--------|------|------|
| GET | `/api/v1/agents` | List agents; optional `?orgId=` for org-scoped list. |
| GET | `/api/v1/agents/:id` | Agent + credentials (authenticated). |
| PATCH | `/api/v1/agents/:id/confirm-download` | Marks keypair delivered (owner only). |
| POST | `/api/v1/agents/:did/ping` | Public ping by DID URL segment; updates activity fields. |
| GET | `/api/v1/passport/:did` | **Public** passport JSON for verifiers (agent + non-revoked VCs). |
| GET | `/.well-known/did.json` | Platform DID document for signature verification. |

**Mounted:** `backend/src/http/registerApiRoutes.ts` (public passport router includes `/api/v1/passport/...` and `/.well-known/did.json`).

---

## 10. Session and cookies

**Auth responses** (`/api/v1/auth/*` including `/me`): built with **`sessionUserPayload`** so **`deviceVerified`** reflects **`isDeviceVerificationComplete`**, not the raw DB boolean alone.

**Cookie security:** **`SESSION_COOKIE_SECURE`** env (`true`/`false`) controls `Secure` flag — see `backend/src/lib/authCookie.ts`. Use `false` for `http://localhost`.

---

## 11. Frontend surfaces

| File | Role |
|------|------|
| `frontend/src/components/qlix/agents/CreateAgentModal.tsx` | Wizard + submit + result panels (cloud vs local). |
| `frontend/src/components/qlix/agents/AgentsListView.tsx` | List + opens modal; passes `orgId`, `deviceVerified`. |
| `frontend/src/components/qlix/agents/AgentDetailView.tsx` | Detail: identity, scopes, VCs. |
| `frontend/src/lib/agents-api.ts` | Typed API client; scope constants; **`createAgent(body, stepUpToken)`**. |
| `frontend/src/lib/webauthn.ts` | Registration + authentication helpers returning **`stepUpToken`**. |
| `frontend/src/lib/auth-api.ts` | **`AuthSuccessResponse.user.deviceVerified`**. |

---

## 12. Environment configuration

Authoritative templates:

- **`backend/.env.example`** — `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `QLIX_PLATFORM_DID`, `QLIX_PLATFORM_PRIVATE_KEY`, WebAuthn, `SESSION_COOKIE_SECURE`, etc.
- **`frontend/.env.example`** — `NEXT_PUBLIC_API_BASE_URL`.

---

## 13. Explicitly out of scope (not implemented in this flow)

The following may appear in marketing copy or older docs but are **not** wired here:

- **`qlix` Python CLI** (`pip install qlix`, `qlix init`) — instructions may appear in UI copy only.
- **Luna** engine bundled at `sdk/python/qlix/luna/` — separate runtime; **no** call from Express agent creation.
- **Cloud worker** that executes agent workloads after registration.
- **Rotate / suspend / delete** agent actions on detail page (if not built).
- **Separate “public registry”** service — verification today is **`GET /api/v1/passport/:did`** + **`/.well-known/did.json`**.

---

## 14. File index (quick navigation)

| Area | Path |
|------|------|
| Agents orchestration | `backend/src/agents/agents.service.ts` |
| Agents repo / guards | `backend/src/agents/agents.repository.ts` |
| JIT | `backend/src/agents/jit.ts` |
| DID | `backend/src/agents/did.ts` |
| Keypair / Ed25519 helpers | `backend/src/agents/keypair.ts` |
| Types | `backend/src/agents/agents.types.ts` |
| Device verification | `backend/src/deviceVerification/deviceVerification.ts` |
| VC issuance | `backend/src/credentials/credentials.service.ts` |
| Platform keys | `backend/src/credentials/platformIdentity.ts` |
| Step-up JWT | `backend/src/lib/authTokens.ts` |
| Create agent route | `backend/src/routes/createAgentsRouter.ts` |
| WebAuthn routes | `backend/src/routes/createWebauthnRouter.ts` |
| Public passport | `backend/src/routes/createPublicPassportRouter.ts` |
| Env loading | `backend/src/config/loadEnvironmentConfig.ts` |
| Wizard UI | `frontend/src/components/qlix/agents/CreateAgentModal.tsx` |

---

*This document should be updated when behavior or routes change.*
