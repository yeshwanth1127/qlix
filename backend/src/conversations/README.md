# Conversation middleware

This module owns durable, multi-turn conversations independently of Teams,
individual agents, and channel providers.

## Invariants

- A thread is one logical conversation. Individual messages are immutable events
  in that thread; they are never separate threads.
- A process is an optional parent for a campaign, Team run, scheduled job, or API
  batch. Its counters are updated incrementally as child threads change state.
- Every thread is pinned to an immutable published workflow version.
- One thread is ordered with optimistic version checks. Different threads may run
  concurrently.
- External work is at-least-once. The outbox idempotency key
  `threadId:nodeId:nodeVisit:effectType` makes provider operations effectively
  once when adapters honor that key.
- Inbound correlation is fail-closed: reply-to message, external channel thread,
  participant + workflow, then participant address. Ambiguous matches do not pick
  a thread.
- Workflow JSON can invoke only explicitly registered action and channel plugins.
  Classification is limited to the intent labels declared on the current node.

## Workflow nodes

`send`, `ask`, `collect`, `branch`, `classify`, `action`, `wait`, `approval`,
`subflow`, `handoff`, `complete`, and `fail` are supported. The compiler rejects
duplicate IDs, missing destinations, unreachable nodes, invalid validation
patterns, and workflows without a terminal node.

The runtime performs exact matching and validation first. A `classify` node emits
the allowlisted `conversation.classify` action only when deterministic matching
does not resolve the input. Low-confidence or invalid plugin output follows the
node's `unclearNext` edge.

## Service API

Authenticated endpoints are mounted under `/api/v1/conversations`:

- `POST /workflows` publishes an immutable version.
- `POST /processes` creates an optional parent process.
- `GET /processes/:id` returns aggregate counters.
- `POST /threads` starts a thread and executes until its first wait boundary.
- `GET /threads/:id` returns the projection and event history.
- `POST /threads/:id/signals` applies an idempotent inbound/action/timer/approval
  signal and executes to the next wait boundary.
- `POST /correlate` resolves provider metadata to a thread without guessing.

API keys use `conversations:read` and `conversations:write` scopes.

## Integration

Teams' existing WhatsApp wait triggers use `legacyTeamWait.adapter.ts`. One child
thread is created for each contacted recipient, inbound replies are mirrored as
events, selected TTL changes update correlation bindings, and expiry/cancellation
closes the corresponding threads. The old Team checkpoint remains authoritative
during migration, so current runs continue to work.

New integrations should publish a workflow, create one process per campaign or
parent job, start one thread per logical contact/case, and keep only process/thread
IDs in their own checkpoints. Channel delivery and application actions are added
through `ConversationPluginRegistry`; durable timers are fired by the background
scheduler.

