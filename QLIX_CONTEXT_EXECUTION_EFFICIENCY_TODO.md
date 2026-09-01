# Qlix Context, Execution, and Efficiency TODO

Date: 2026-08-28
Scope: shared Context Plane, Execution Graph, Tool Plane, Inference Plane, and Telemetry Plane.

This is the durable checklist for the platform-wide roadmap. The Agent Runtime Modernization TODO (`QLIX_AGENT_RUNTIME_MODERNIZATION_TODO.md`) is a separate track (Phases 1–11 already wired). Update checkboxes after every completed change.

## Already in production (do not redo)

- [x] Content-addressed `ContextObject` table with org ACL, field selection, and char budget.
- [x] Team `contextPolicy.mode = referenced` stores worker Results once and passes `ctx:*` indexes.
- [x] Generic `context_get` tool for Team workers (`team.dispatch`).
- [x] Assessment role-scoped context adapter (`assessment_context_get`).
- [x] Builder deterministic context compiler and fact ledger.
- [x] Runner context_size / context_size_round totals (not yet per-component).
- [x] Read-only tool fan-out, Team equal-stage fan-out, subagent fan-out, local WorkflowEngine.
- [x] Team Result contracts, targeted repair, checkpoints, and wait/resume.
- [x] Auto/cascade routing and in-process completion + tool-schema caches.
- [x] `ExecutionBudget` types on Team config and `DispatchRequest` (not enforced).
- [x] `mapConcurrentOrdered` used by Team stages.

## Stopped mid-way (this continuation)

Context Plane storage landed for Team handbacks, then stopped before a shared resolver, AgentRun packs, RunState, component telemetry, or budget accounting. Parallel scheduler is a concurrency helper, not a durable graph.

---

## Phase 0 — Measurement contract

- [x] Stable run / round / tool IDs exist on AgentRun events and the run timeline.
- [x] Emit context-pack component token estimates before concatenation.
- [x] Include component breakdown on `context_size_round` and the usage API.
- [x] Shared tracing envelope on Gateway, TeamRun, subagents, Brain, and conversations.
- [x] Dashboard that explains ≥95% of prompt tokens by component and Team tokens by stage/attempt.
- [x] Success-quality guardrails: completion rate, contract pass rate, artifact validity, user retry rate.

## Phase 1 — Shared contracts and persistence

- [x] Versioned `ContextRef` / `ContextRequest` / `ContextPack` schemas.
- [x] Versioned `ExecutionBudget` and `TraceEnvelope` links for context packs.
- [x] Matching TypeScript and Python types/fixtures.
- [x] `ContextObject` persistence (flattened v1: version + hash on the object).
- [x] Tenant / agent / scope checks at the Context service boundary.
- [x] Team Result adapter into Context Plane.
- [x] `ExecutionRunState` persistence with optimistic `state.patch`.
- [x] Separate `ContextVersion` / `ContextEdge` tables (current object is content-addressed; split when lineage queries need it).
- [ ] Object/blob storage for large non-JSON artifacts.
- [ ] Adapters for Brain chunks, uploaded files, and conversation workflow state.
- [x] AgentRun can receive a versioned Context Pack and `context_get` a referenced object without copying the full transcript.

## Phase 2 — Context Resolver

- [x] Deterministic selection and token budgeting for memory + task + Team refs.
- [x] Compact views + references for Team handbacks.
- [x] Progressive-disclosure `context_get` for any AgentRun that carries refs.
- [x] `state_read` / `state_patch` for Team executions.
- [x] Migrate ordinary AgentRun memory injection behind the Resolver (dual-write: `memoryBlock` still sent).
- [x] Scoped semantic retrieval after deterministic filters (`context_search` + Brain minScore).
- [x] Cache packs by request + source versions + permissions.
- [x] Move Brain prompt concatenation behind the Resolver (poll retrieves once; runner prepends only on fallback).
- [ ] Exit measurement: ≥25% lower inline context on selected Team/long-run workloads with no round or failure regression.

## Phase 3 — Hierarchical budgets (shadow)

- [x] Parent/child budget types and shadow evaluation helper.
- [x] Emit `budget_shadow` decisions on Team workers without blocking.
- [ ] Reserve finalization and repair capacity.
- [ ] Feed provider usage and tool/retrieval/wall-time into one ledger.
- [ ] Graceful actions: shrink next pack, skip optional node, reduce reasoning, request expansion.
- [ ] Exit: shadow totals within 5% of RunUsage, including Team children and subagents.

## Phase 4 — Result contracts, repair, checkpoints

- [x] Teams Result contracts and no-tool repair (existing).
- [ ] Versioned contract registry with full JSON Schema (Ajv).
- [ ] Structured `NodeResult` for every execution node, not only Teams.
- [ ] Generic node checkpoint (inputs, snapshot, tool effects, candidate, remaining work).
- [ ] Idempotent retries keyed by `(executionId, nodeId, attempt)`.

## Phase 5 — Tool Plane and composites

- [x] Agent/Team scope gating, JIT, and schema budget (existing).
- [ ] Finite capability packs with side-effect, idempotency, cache, and contract metadata.
- [ ] Highest-frequency composites from telemetry.
- [ ] Deterministic normalize/parse/filter/aggregate/dedup/provenance as backend ops.

## Phase 6 — Durable Execution Graph

- [x] Topological stage grouping and ordered concurrent map (in-memory).
- [x] Ready-node helper over explicit `dependsOn` edges.
- [ ] Persist graphs, nodes, edges, attempts, locks.
- [ ] Compile Team stages, subagent batches, and Luna WorkflowGraph into the same model.
- [ ] Cancellation propagation and critical-path telemetry.
- [ ] Exit: replay equals sequential Teams, then parallel stages lower wall time at equal tokens/success.

## Phase 7 — Conditionals, per-node routing, distributed cache

- [ ] Node predicates over validated state and Results.
- [ ] Per-node model/reasoning routing.
- [ ] Redis + source-version-aware retrieval/transform caches.
- [ ] Enforce low-risk budget dimensions; keep expansion approval for high-impact work.

## Phase 8 — Migrate and retire duplicates

- [ ] Teams planning/checkpoints/state on Execution Graph + Context Plane.
- [ ] Agent memory and local session artifacts on the backend Context service.
- [ ] Managed/cloud runs use durable graph execution; local engine remains the offline adapter.
- [ ] Document platform contracts and SDK clients.

## Continuation checkpoint

- Current slice: Phase 0 is complete, and the first remaining Phase 1 item is done. Shared `qlix.trace-envelope.v1` is stamped on Gateway, AgentRun, TeamRun, subagents, Brain, and conversations. Usage explains billed prompt tokens by component (target ≥95%) and Team tokens by stage/attempt, and shows success-quality rates. Context objects now dual-write `ContextVersion` snapshots and `ContextEdge` lineage (`supersedes` / `derived_from`); object rows keep the current snapshot so existing `ctx:*` refs still resolve.
- Compatibility: `memoryBlock` still sent; Brain poll load still writes audit once on cache miss; runner prepends only when the pack does not own Brain; console Brain Ask is unchanged (no minScore).
- Last verified: trace + timeline + usage attribution + execution quality + context ref tests passed; `npx tsc --noEmit`; migration `20260828150000_context_version_edge` applied on live DB.
- Next: Phase 1 remaining items in order — object/blob storage for large non-JSON artifacts, then adapters for Brain chunks, uploaded files, and conversation workflow state. Do not start Phase 2 exit measurement or Phase 3 until those are done.
