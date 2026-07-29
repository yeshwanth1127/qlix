# Qlix Mobile

Flutter client for the Qlix backend — chat-first companion to the web console.

## Status

**Phase 0** (backend bearer auth + app skeleton) — done  
**Phase 1** (auth, Overview, Agents, streaming chat) — done  
**Phase 2** (Active runs, Audit, Usage, Wallet, Settings) — not started  
**Phase 3** (AI Builder shipped early; JIT approve UI, Teams, …) — partial

## Setup

```bash
cp .env.example .env
# Edit QLIX_API_BASE_URL for your device:
#   Android emulator  -> http://10.0.2.2:4000
#   iOS simulator     -> http://localhost:4000
#   Physical device   -> http://<LAN-IP>:4000

flutter pub get
flutter run
```

Backend must accept `Authorization: Bearer <jwt>` (already shipped) and return `token` in login/signup/refresh JSON.

## App structure

```
lib/src/
  core/           # Dio client, secure store, providers
  models/         # Session, Agent, Chat, Dashboard, NL builder
  repositories/   # Auth, Agents, Chat, Dashboard, NL builder
  features/
    auth/         # Sign in / sign up
    shell/        # Drawer navigation
    overview/     # Home metrics + agents + recent audit
    agents/       # List + detail
    chat/         # SSE streaming chat
    ai_builder/   # NL → create agent (mobile step-up)
```

## Next up (Phase 2)

1. Active runs
2. Audit log (full page + filters)
3. Settings (profile / sign-out / danger zone)
4. Usage + Wallet/Billing balances
