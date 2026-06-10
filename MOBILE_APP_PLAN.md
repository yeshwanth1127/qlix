# Qlix Mobile App — Implementation Plan

> **Decisions locked in:** Flutter · Chat-first MVP · New client on the existing backend
> **Status:** Plan only (no code written yet)

---

## 1. What "the browser app" actually is

The current web product is a **Next.js 16 / React 19 dashboard** (`frontend/`) talking to an
**Express + Prisma REST API** (`backend/src/`) at `/api/v1/*`. Agents themselves execute in a
separate **Python SDK runner** (`sdk/python/qlix/`) in cloud / local / hybrid modes.

The mobile app is a **new client for the same backend** — we are *not* porting the runner, only
the dashboard surface.

The web client's full surface (from `frontend/src/lib/navigation/individualNav.ts`) is ~17
destinations across two workspace kinds (`individual` / `organization`):

> AI Builder · Overview · Agents · Active runs · Teams · AI Brain · Knowledge · Passports ·
> Audit · Connectors · Skills · Credentials · API keys · Usage · Settings · Wallet/Billing · Members

The crown-jewel interaction is **agent chat** (`frontend/src/components/qlix/agents/AgentChatPanel.tsx`):
create conversation → POST message → open an **SSE stream** (`EventSource`) that emits:

- `delta` — streamed token text
- `log` — activity steps + base64 `browser_frame` screenshots
- `done` — run finished (with status)

plus a live browser view and JIT permission prompts.

---

## 2. Two hard truths up front

1. **None of the frontend code ports.** It's Next.js + heavy three.js/gsap visuals. What ports is
   *API knowledge* — the `frontend/src/lib/*-api.ts` files are an exact contract spec for every
   screen. Reuse them as the blueprint, rewrite the UI in Flutter.

2. **The backend is browser-only on two axes** and needs changes before any mobile client works well:
   - **Auth is cookie-only.** `backend/src/middleware/authenticateUser.ts:19` reads the JWT
     *exclusively* from `request.cookies`. Login returns the token only via `Set-Cookie`, never in
     the body (`backend/src/routes/createAuthRouter.ts:409`). Native apps want a **bearer token in
     secure storage**, not cookies.
   - **Step-up uses WebAuthn passkeys** (`X-QLIX-Device-Step-Up` header) for sensitive ops like
     agent creation.

---

## 3. Stack — Flutter

Flutter drops TypeScript reuse, so the `frontend/src/lib/*-api.ts` files become the **API contract
spec** — re-model each DTO in Dart.

| Need | Package | Notes |
|---|---|---|
| HTTP | `dio` | Interceptor injects `Authorization: Bearer <jwt>`, handles 401→refresh |
| State / data | `riverpod` + `dio` | Each `*-api.ts` function → a provider/repository method |
| JSON models | `freezed` + `json_serializable` | Generate from DTOs in `agents-api.ts:72-113` (`AgentDTO`, `VerifiableCredentialDTO`, `PermissionScope`, …) |
| Secure token | `flutter_secure_storage` | Stores the JWT (Keychain / Keystore) |
| **SSE streaming** | `dio` streamed `ResponseType.stream` **or** `flutter_client_sse` | No native `EventSource` in Flutter — open a streamed GET with the bearer header and **hand-parse `event:` / `data:` lines** into `delta` / `log` / `done`. Replaces the `EventSource` logic in `AgentChatPanel.tsx:390-515` |
| Biometrics | `local_auth` | App lock + step-up gate |
| Passkey step-up | `credential_manager` (Android) / native `ASAuthorization` (iOS) | **Less mature than RN/web** — see risks |
| Markdown | `flutter_markdown` | Agent replies render plain text today; upgrade-friendly |

---

## 4. Backend enablers (do first — small, unblock everything)

These are additive and **must stay backward-compatible** so the web app keeps working.

1. **Accept `Authorization: Bearer <jwt>`** in `backend/src/middleware/authenticateUser.ts:19` as a
   *fallback* to the cookie (never a replacement).
2. **Return the JWT in the login/signup/refresh JSON body** (additive) so the app can store it.
   Keep `Set-Cookie` for web. See `createAuthRouter.ts:411`.
3. **Add `Authorization` to CORS `allowedHeaders`** in `backend/src/http/createHttpApplication.ts`
   (minor; native apps aren't subject to CORS but keep parity).
4. **SSE auth via header** — confirm `/runs/:id/stream` accepts the bearer token.
5. **(Later)** Push-notification registration endpoint for `done` / JIT-pending events.

---

## 5. Chat-first MVP scope (Phase 0 + 1)

**Backend prerequisites (small):**
1. Bearer-token fallback in `authenticateUser.ts:19`.
2. Return JWT in login/signup/refresh JSON body — `createAuthRouter.ts:411`.
3. Confirm `/runs/:id/stream` SSE accepts the bearer header.

**App slice:**
- Sign in / sign up → store JWT in secure storage → `GET /auth/me` rehydrate.
- Workspace-kind routing (individual vs organization) from the session payload.
- Agents list + detail (`listAgents` `agents-api.ts:252`, `getAgent` `agents-api.ts:261`).
- **Streaming chat**: create conversation → POST message → consume SSE → render token deltas, the
  activity timeline, base64 `browser_frame` screenshots, model picker, brain toggle, stop/clear.
  Port the dropped-stream recovery (`fetchMessagesAfterRun` / `mergeServerMessages`) faithfully —
  it's what makes chat reliable on flaky mobile networks.

This proves the two riskiest things (bearer auth + SSE on native) and delivers ~80% of daily value.

---

## 6. Full feature phasing (parity is the eventual goal)

| Phase | Theme | Includes |
|---|---|---|
| **0** | Enablers + skeleton | Backend bearer auth, Flutter project, secure-store session, Dio/Riverpod API layer, workspace-kind routing, tab nav |
| **1** | Read + Chat (MVP) | Sign in/up, Overview, Agents list + detail, **streaming agent chat** |
| **2** | Operate | Active runs, Audit log, Usage, Wallet/Billing balances, Settings |
| **3** | Create + Govern | AI Builder (NL → agent), agent creation (**passkey step-up**), Teams, Passports, JIT approvals, Connectors, Knowledge, Skills, Credentials, API keys, Members |
| **4** | Native polish | Push notifications (run-complete / JIT-pending), biometric app lock, offline cache, deep links |

---

## 7. SSE event contract (port target)

The mobile SSE parser must reproduce the event shapes consumed in
`AgentChatPanel.tsx:403-453`:

- **`delta`** → `{ data: { text: string } }` — append to the streaming agent message.
- **`log`** → `{ seq: number, data: object }`. Two sub-cases:
  - `data.message === "browser_frame"` with `data.image_base64` → push a browser frame
    (`tool`, `label`, `mime`, `imageBase64`).
  - otherwise → summarize into an activity step (see `agentToolActivity.ts`).
- **`done`** → `{ status?: string }`. On `failed`, surface the error; otherwise refetch the
  conversation messages to reconcile the final state.

Reliability detail: on stream error or `done`, the web client **refetches conversation messages**
with a backoff (`[0, 300, 600, 1000, 1500, 2500]` ms) and merges, preserving any locally streamed
content/activity/frames. Replicate this — it is the core resilience mechanism.

---

## 8. Top risks for the Flutter MVP

1. **SSE has no first-class Flutter primitive** — you parse the wire format yourself. Budget time
   here; it's the core of the app. Event shapes fully specified in `AgentChatPanel.tsx:403-453`.
2. **Passkey step-up is the weakest Flutter story** — but agent *creation* is out of MVP scope, so
   this risk is deferred to Phase 3. When you get there, consider a mobile-friendly biometric
   step-up path server-side instead of fighting Flutter WebAuthn plugins.
3. **Cookie→bearer migration must stay backward-compatible** so the web app keeps working — make the
   bearer path a *fallback*, never a replacement.
4. **Browser-specific concepts don't translate** — "control desktop apps", hybrid-runtime starter
   ZIPs are desktop ideas. Surface them as read-only / managed-elsewhere on mobile; don't replicate.

---

## 9. Reference map (web → mobile)

| Web file | Use for |
|---|---|
| `frontend/src/lib/auth-api.ts` | Auth endpoints + `AuthSuccessResponse` shape |
| `frontend/src/lib/agents-api.ts` | Agent DTOs, permission scopes, chat/conversation/run endpoints |
| `frontend/src/lib/navigation/individualNav.ts` | Full destination list for parity |
| `frontend/src/lib/workspace.ts` | Workspace-kind routing rules |
| `frontend/src/components/qlix/agents/AgentChatPanel.tsx` | Chat + SSE behavior to port |
| `frontend/src/components/qlix/agents/agentToolActivity.ts` | Activity-step summarization |
| `backend/src/middleware/authenticateUser.ts` | Where to add bearer support |
| `backend/src/routes/createAuthRouter.ts` | Where to add token-in-body |
| `backend/src/http/createHttpApplication.ts` | CORS allowed headers |
