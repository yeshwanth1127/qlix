# Qlix Agent Runtime Modernization TODO

This file is the durable implementation checklist for improving Qlix, Luna, and Luna Teams without removing or weakening existing capabilities. Update the checkboxes and the continuation checkpoint after every completed change.

## Non-negotiable compatibility rules

- [ ] Existing Luna agent types remain available.
- [ ] Existing Python imports remain valid.
- [ ] Existing tool names and aliases remain valid.
- [ ] Existing permission, JIT, and always-on scopes retain their meaning.
- [ ] Existing `agent.json` files remain valid.
- [ ] Existing cloud, hybrid, and local execution remain supported.
- [ ] Existing connectors, skills, MCP tools, channels, and document tools remain supported.
- [ ] Existing signed action logging, approval, billing, and wallet behavior remain authoritative.
- [ ] Existing individual-agent, subagent, Luna Teams, wait/resume, and conversation workflows remain supported.
- [ ] Existing persisted runs, conversations, Team runs, and workflow versions remain readable.
- [ ] Old and new paths run side by side until compatibility tests prove equivalent behavior.

## Phase 1 — Capability safety net

- [x] Generate a machine-readable inventory of backend scopes.
- [x] Inventory Luna agent registry entries.
- [x] Inventory Luna tool registry entries.
- [x] Inventory registered Luna inference engines.
- [x] Inventory cloud, hybrid, and local tool availability as a deterministic maximum supported surface with explicit gating semantics.
- [x] Inventory built-in/external skill surfaces, dynamic MCP naming/transports, runner aliases, connectors, gateway channels, and conversation plugins.
- [x] Inventory Luna Teams public contracts and commander tools.
- [x] Snapshot configuration defaults (public Python exports are captured).
- [x] Add a consistency check: every advertised scope maps to an implementation or governing policy outside its declaration.
- [x] Add a consistency check: every runner-exposed tool has capability metadata.
- [x] Add a consistency check: aliases continue resolving to the same capability.
- [x] Add regression fixtures for research, browser, coding, files, documents, email, WhatsApp, scheduling, Brain, MCP, Teams, waits, and assessment.

## Phase 2 — Shared contracts

- [x] Define a versioned capability descriptor shared by current implementations.
- [x] Define a versioned runtime event envelope.
- [x] Define versioned runner/backend request and response contracts.
- [x] Generate or validate matching Python and TypeScript contract fixtures.
- [x] Preserve current wire payloads through compatibility adapters.
- [x] Add contract-version negotiation and fail-loud incompatibility errors.

## Phase 3 — Generalized Luna Teams provenance

- [x] Preserve the existing generic `inputRefs`, `recordRefs`, and `knowledgeRefs` contract.
- [x] Add typed provenance for tool calls, evidence records, and artifacts (domain-record descriptors remain for Phase 4).
- [x] Let each Team select a result/provenance policy that is copied to every dispatch and checkpoint.
- [x] Validate assessment citations against successful durable tool events and authoritative backend evidence/artifact records.
- [x] Keep outreach/spreadsheet row-lineage enforcement unchanged.
- [x] Add an assessment result contract using database-verified evidence and artifact references.
- [x] Select the assessment contract for examiner Team workers.
- [x] Capture successful worker tool references automatically from durable runner events; evidence and artifact IDs are database-verified before accepting the Result.
- [x] Correct assessment artifact-search filtering and diagnostics.
- [x] Add a sanitized regression fixture for the Pooja assessment run with eight artifact uploads and cross-session rejection.

## Phase 4 — Capability catalog and providers

- [x] Add one authoritative descriptor for each managed-runtime capability: name, schema, scope mode, scopes, JIT, runtime, risk, and provider; dynamic capability families are adapted below.
- [x] Adapt existing Luna `BaseTool` implementations without renaming them.
- [x] Adapt MCP tools, connectors, backend proxy tools, browser tools, and local tools.
- [x] Generate current runner tool arrays from descriptors where safe (shadow consumer only).
- [x] Compare generated arrays with frozen snapshots before switching.
- [x] Retain manual overrides for capabilities that require product-specific behavior.

## Phase 5 — Unified web and research architecture

- [x] Preserve every current Qlix research option: Tavily, DuckDuckGo, Exa/Agent Reach, Jina Reader, social research, video research, GitHub research, HTTP fetch, standalone/managed browser, remote CDP/Browserbase, and Cloudflare browser fallback.
- [x] Introduce one provider-neutral web capability with separate search, read/fetch, platform-research, and browser operations.
- [x] Keep existing public tool names (`web_search` and `research_*`) through compatibility consumers.
- [x] Give every provider explicit availability, configuration, timeout, cancellation, result, source, and error behavior.
- [x] Select providers deterministically rather than by import, registration, or failure order.
- [x] Implement an explicit escalation path: search provider -> direct/Jina read -> interactive browser.
- [x] Normalize sources across providers with URL, title, excerpt, publication time, provider, and retrieval time.
- [x] Prefer authoritative and official sources when the request asks for them.
- [x] Preserve and strengthen Qlix SSRF, scope, JIT, audit, and signed-action protections; initial URLs and redirects are checked without weakening existing governance.
- [x] Make protected URL fetching work in a normal SDK installation: use Luna Rust when present and a secure Python fallback when the extension is absent.
- [x] Declare every dependency required by advertised Tavily and DuckDuckGo fallback behavior.
- [x] Keep cloud-only research providers observable and fail clearly when their runner dependencies are absent.
- [x] Add keyless replay tests for every provider and declared fallback path.
- [ ] Add identical live canaries for every provider; self-skip with explicit reasons when credentials, binaries, or platform sessions are absent.
- [x] Compare legacy and neutral provider routes in opt-in shadow mode without switching execution defaults.

## Phase 6 — Governed tool execution

- [x] Define one ordered execution pipeline: resolve, validate, authorize, approve, pre-log, execute, validate result, complete log, bill, emit.
- [x] Keep `ToolExecutor` and `QlixToolExecutor` as compatible public facades.
- [x] Route built-in, MCP, connector, cloud, and hybrid tools through the same governance stages.
- [x] Preserve current error types and user-visible failure behavior.
- [x] Add idempotency protection for retries around action completion and billing.
- [x] Add provider conformance tests for read-only, mutating, JIT, failing, and timed-out tools.

## Phase 7 — Runner consolidation

- [x] Finish moving shared cloud/hybrid behavior into `runner_common.py` or focused shared services.
- [x] Share context assembly, inference, events, usage, cancellation, artifacts, and result handling.
- [x] Keep environment-specific filesystem, browser, shell, GUI, credentials, and sandbox providers separate.
- [x] Preserve current prompts and routing until transcript tests prove replacements equivalent.
- [x] Remove duplicated code only after both runner suites pass.

## Phase 8 — Context and memory

- [x] Inventory every current model-visible context source.
- [x] Assign deterministic ordering, priority, trust, persistence, and token budgets.
- [x] Preserve objectives, requirements, decisions, approvals, artifacts, and unfinished work.
- [x] Spill oversized tool output to private content-addressed artifacts while retaining safe references; never copy full compacted content into telemetry or ordinary results.
- [x] Replace lossy summaries with structured compaction behind the existing session API.
- [x] Record compaction as a runtime event containing metadata and references only.
- [x] Add long-run tests proving requirements survive compaction and full session history remains privately retrievable.

## Phase 9 — Cancellation and lifecycle

- [x] Define one cancellation signal from backend to runner and child work.
- [x] Cancel active model requests.
- [x] Stop tool execution cooperatively.
- [x] Terminate subprocess trees on timeout or cancellation.
- [x] Close browser sessions and release sandbox resources.
- [x] Stop nested subagents and Team workers.
- [x] Record one authoritative terminal state.
- [x] Add tests for cancellation at every lifecycle stage.

## Phase 10 — Replayable run timeline

- [x] Link messages, run events, signed actions, approvals, Team events, conversation events, usage, and billing by stable IDs.
- [x] Preserve the signed action ledger as the security and billing authority.
- [x] Build a read model for one chronological run timeline.
- [x] Record a privacy-safe manifest (stable IDs, hashes, roles, sizes, tool names, and schema hashes) for model-visible and injected run inputs; keep content in its existing governed source rather than duplicating secrets into telemetry.
- [x] Add deterministic replay fixtures for individual and Team runs.
- [x] Expose diagnostic timelines without leaking secrets or hidden reasoning.

## Phase 11 — Plugin lifecycle

- [x] Extend registries with owner metadata and disposable registrations.
- [x] Add dependency and configuration validation.
- [x] Add activation, draining, deactivation, and cleanup behavior.
- [x] Apply the lifecycle to gateway channels and conversation plugins first.
- [x] Extend it to Luna tools, engines, connectors, MCP resources, skills, and organization plugins.
- [x] Ensure disabling a plugin cannot leave stale tools or active resources; explicit organization disables filter plugin-owned scopes at runner poll without deleting grants, so re-enable restores the prior setup.

## Phase 12 — Capability-by-capability DeepSeek comparison

- [ ] Generate an authoritative mapping from every Qlix tool and capability to its DeepSeek Harness counterpart, or mark it as uniquely Qlix/DeepSeek.
- [ ] Compare public behavior, schemas, permissions, provider separation, lifecycle, cancellation, persistence, replay, errors, security, and model-facing output.
- [ ] Run the same keyless contract tests against comparable capabilities.
- [ ] Run the same live canary tasks when both sides have credentials, recording provider and environment limitations honestly.
- [ ] Measure completion quality, source quality, latency, retries, output size, token use, cost, and failure recovery.
- [ ] Produce a machine-readable comparison result plus a short plain-English report.
- [ ] Separate architectural strengths from provider/model quality so results remain fair.
- [ ] Do not copy or replace a Qlix capability automatically from benchmark results.
- [ ] Draft a user-reviewed improvement plan only after the complete comparison report exists.

## Phase 13 — Evaluation and optimization

- [ ] Add keyless transcript replay for representative Qlix tasks.
- [ ] Add real-provider canary tests that self-skip without credentials.
- [ ] Run live LLM evaluations through OpenRouter pinned to `openrouter/stealth/ox-alpha` (Ox Alpha); never replace production model defaults as part of testing, and fail/skip clearly if the preview model is unavailable.
- [ ] Measure completion, tool precision, retries, latency, tokens, cost, approvals, and policy failures.
- [ ] Feed measured outcomes into model routing.
- [ ] Keep pinned model behavior unchanged.
- [ ] Add safe provider fallback and circuit-breaker evaluations.

## Phase 14 — Documentation and rollout

- [ ] Document the stable public API and deprecation policy.
- [ ] Document capability/provider ownership.
- [ ] Document runner and Team lifecycle state transitions.
- [ ] Roll out each major path behind a compatibility flag.
- [ ] Compare old and new behavior in shadow mode where possible.
- [ ] Remove a legacy path only after compatibility evidence and an explicit migration note.

## Continuation checkpoint

- Current phase: Phase 12 — Capability-by-capability DeepSeek comparison is next (Phases 1–11 are implemented and wired into live paths; Phase 5 credential-dependent live canaries remain an evaluation task, not a runtime cutover dependency).
- Current task: Phases 1–11 are end-to-end wired. The backend and cloud/hybrid runners use the versioned request/response contract with legacy compatibility; managed tool metadata comes from the capability catalog; local/cloud/hybrid search, read, social, video, GitHub, managed-browser and browser-failover routes use deterministic provider selection; and QlixSDK owns Luna runtime cleanup through the plugin lifecycle.
- Live rollout: backend rebuilt and healthy; Phase 10/11 migrations applied; all eight idle Full stack Examiner Team runner containers rebuilt/restarted onto `qlix-cloud-runner:06d0178995851581-shared-base-4`. Runner fingerprinting now includes contracts, catalogs, research routing, browser failover, SDK lifecycle, and plugin lifecycle files so future changes cannot silently reuse a stale image.
- Newly queued work: Phase 5 unifies Qlix's broad web/research providers behind DeepSeek-style clean capability seams; Phase 12 performs a complete counterpart comparison before any follow-up plan.
- Live LLM test requirement: use OpenRouter model `openrouter/stealth/ox-alpha` (Ox Alpha), isolated from production defaults.
- Last verified commands: focused live-wiring contract/research/browser/lifecycle sets (34 passed); full Python suite (251 passed, 12 known pre-existing/environment-sensitive failures); full backend suite (332 passed, 3 pre-existing NL-builder expectation failures); `npx prisma validate`; `npx tsc --noEmit --pretty false`; `uv run --extra dev python -m compileall -q qlix`; `git diff --check`; `npx prisma migrate deploy` (Phase 10/11 migrations applied successfully to the configured local Qlix database).
- Known test note: `test_tool_preference_text_is_empty_for_plain_run` expects an empty plain-run preference, while the current runtime intentionally emits a conversational/follow-up nudge; this predates Phases 6–7 and was not changed here.
- Full-suite baseline note: 248 Python tests pass; 12 unrelated existing/environment-sensitive tests still fail (browser-collapse expectations, unavailable spreadsheet extras, older email/tool-budget expectations, Windows path rendering on macOS, the plain-run preference expectation, and the sensitive-path test environment). The backend suite passes 332 tests with 3 existing NL-builder expectation failures. No Phase 9/10/11 lifecycle, replay, gateway, conversation, Team, registry, or compatibility test is among those failures.
- Important working-tree note: The repository contained substantial user changes before this modernization began. Preserve them and avoid unrelated formatting or rewrites.
