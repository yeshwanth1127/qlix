# Sub-agents

Parent-only mid-run fan-out for bounded side work. Distinct from **Teams** (durable supervisor + worker roster).

## V1 (shipped)

- Tools: `spawn_subagents` / `await_subagents` (array-native for N children)
- Execution: nested in-process tool loops inside the parent run (same `agentId` / DID)
- Persistence: `SubAgentInvocation` rows + parent-run log events (`subagent_spawned`, `subagent_completed`)
- Caps: `QLIX_SUBAGENT_MAX_PER_RUN`, `QLIX_SUBAGENT_MAX_PARALLEL`, `QLIX_SUBAGENT_MAX_DEPTH` (default depth=1)
- Gate: `QLIX_ENABLE_SUBAGENTS=1` (default off)
- Spawn surface: runner auth only (active parent run) — never user `POST /agents` / NL create / UI

Why nested (not same-agent queued child runs): one runner claims one run per agent; awaiting a queued sibling deadlocks. See plan notes in repo history.

Legacy `delegate_task` + `POST .../runs/delegate` remains for fire-and-forget only (`QLIX_ENABLE_DELEGATION`); prefer sub-agents when you need joinable results.

## V2 (reserved — non-breaking)

Promote nested invocations to **separate Agent identities** behind the same tools:

| Field / path | Intent |
|--------------|--------|
| `Agent.parentAgentId` | FK to spawning parent |
| `Agent.agentKind = 'subagent'` | Distinguish from `standard` / `org_brain` |
| `Agent` ephemeral flag | Auto-retire after invocation |
| `SubAgentInvocation.childAgentId` | Link logical invocation → child identity |
| `SubAgentInvocation.childRunId` | Real `AgentRun` on the child |
| Runner-only create | Still no user create-subagent API |

Callers keep using `spawn_subagents` / `await_subagents`; the runtime switches from nested loops to child runners (or shared multi-claim) without schema/tool breaks.

Use V2 when children need distinct scopes ⊆ parent, separate billing/audit actors, or long-lived workers. Until then, Teams remain the durable multi-agent product.
