"""Generalised tool-budget policy — applies to every agent, not one connector.

Motivation
----------
A run costs ``rounds x (tools + system + memory + context) + growth``. Both terms are
multiplicative, so the tool schema is paid once per round: for a Slack agent, 7 rounds
x 2,789 tokens of schema was 61% of the entire run.

Three levers, in decreasing order of leverage, all implemented here:

1. **Round tax.** A tool that does no work still costs a full round — the model's call,
   plus another round to actually answer. ``done`` and the ``brain_query`` stub are pure
   overhead of this kind. Removing them from the schema removes whole rounds.

2. **Discovery tools.** ``find_tools`` / ``call_tool`` exist to page through a catalog too
   large to show at once. On a 20-tool agent they are 216 tokens per round that can never
   pay for themselves; on a 200-tool MCP agent they are the only thing that works. Gate
   them on catalog size instead of loading them unconditionally.

3. **Tier by usage class.** Management operations (create a channel, set presence) are
   loaded on every round of every run even for agents that never touch them.

Cache safety
------------
Every decision here is a function of the AGENT (its scopes, profile, bound MCP servers)
and never of the prompt. Narrowing per agent keeps each agent's prefix byte-stable and
cacheable; narrowing per message is what produced four different tool arrays for one
agent and cost 100% of cache hits. See ``tool_router.scope_groups``.
"""

from __future__ import annotations

import os
from typing import Any

# --------------------------------------------------------------------------------------
# 1. Round tax — tools that consume a round without doing work.
# --------------------------------------------------------------------------------------

#: ``done``: the tool loop already terminates when the model returns text without tool
#: calls, so calling ``done`` costs one round to say "finished" plus another to write the
#: answer. ``brain_query``: the brain context is prepended to the prompt before the run
#: starts, so the executor is a stub that returns a sentence saying exactly that.
NO_OP_TOOLS: frozenset[str] = frozenset({"done", "brain_query"})

#: ``think`` is NOT in the list above. It looks similar but is not: because content
#: without tool calls ends the loop, ``think`` is the only way for a model to take a
#: reasoning step and keep going. Removing it risks agents stopping early, which the
#: empty-response nudge then pays for with more rounds. Gated separately, default on.
THINK_TOOL = "think"

# --------------------------------------------------------------------------------------
# 2. Discovery / delegation — worth their tokens only on a large catalog.
# --------------------------------------------------------------------------------------

META_TOOLS: frozenset[str] = frozenset({"find_tools", "call_tool"})
DELEGATION_TOOLS: frozenset[str] = frozenset({"delegate_task"})

#: Below this many callable tools the whole catalog already fits in the schema, so
#: find_tools/call_tool can only add cost.
DEFAULT_META_TOOL_MIN_CATALOG = 40

# --------------------------------------------------------------------------------------
# 3. Usage tiers — management operations most agents never call.
# --------------------------------------------------------------------------------------

#: Deliberately conservative: only operations that manage the *workspace* rather than do
#: the agent's job. Anything used for discovery during normal work (crm_describe_module,
#: slack_list_channels) stays primary, because removing it breaks real flows.
ADMIN_TOOLS: frozenset[str] = frozenset(
    {
        # Slack workspace administration
        "slack_create_channel",
        "slack_set_channel_topic",
        "slack_set_presence",
        "slack_open_dm",
        # CRM bulk / relationship management
        "crm_bulk_create",
        "crm_bulk_update",
        "crm_convert_lead",
        "crm_link",
        "crm_unlink",
        "crm_upload_attachment",
        "crm_download_attachment",
        "crm_list_attachments",
    }
)


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def _tool_name(tool: Any) -> str:
    if not isinstance(tool, dict):
        return ""
    fn = tool.get("function")
    if not isinstance(fn, dict):
        return ""
    return str(fn.get("name") or "")


def apply_tool_budget(
    tools: list[dict[str, Any]],
    *,
    tool_profile: str = "full",
    has_mcp_servers: bool = False,
) -> list[dict[str, Any]]:
    """Drop tools that cannot earn their per-round cost for this agent.

    Applied to the fully assembled schema list, so it covers every group uniformly —
    built-in, connector and MCP — instead of needing a rule per runtime module.

    Executors are deliberately NOT removed alongside these (see ToolRouter.
    build_executor_map): if a model hallucinates a call to a hidden tool it still
    resolves, and the ``call_tool`` escape hatch keeps working.

    Args:
        tools: assembled OpenAI tool definitions.
        tool_profile: per-agent, persisted. ``lean`` additionally drops ADMIN_TOOLS.
        has_mcp_servers: MCP tools make the catalog large and dynamic, which is exactly
            when discovery tools start paying for themselves.
    """
    profile = (tool_profile or "full").strip().lower()

    drop: set[str] = set()

    if _flag("QLIX_DROP_NOOP_TOOLS", True):
        drop |= NO_OP_TOOLS

    if not _flag("QLIX_ENABLE_THINK_TOOL", True):
        drop.add(THINK_TOOL)

    # Discovery only helps when the catalog is genuinely bigger than the schema shown.
    meta_min = int(os.environ.get("QLIX_META_TOOL_MIN_CATALOG", DEFAULT_META_TOOL_MIN_CATALOG))
    catalog_is_large = has_mcp_servers or len(tools) >= meta_min
    if not catalog_is_large and _flag("QLIX_GATE_META_TOOLS", True):
        drop |= META_TOOLS

    # Sub-agent delegation is a deliberate capability, not a default.
    if not _flag("QLIX_ENABLE_DELEGATION", False):
        drop |= DELEGATION_TOOLS

    if profile == "lean":
        drop |= ADMIN_TOOLS

    if not drop:
        return tools
    return [t for t in tools if _tool_name(t) not in drop]


def budget_report(
    before: list[dict[str, Any]],
    after: list[dict[str, Any]],
) -> dict[str, Any]:
    """Telemetry so the saving is visible in the run timeline rather than assumed."""
    import json

    kept = {_tool_name(t) for t in after}
    removed = sorted({_tool_name(t) for t in before} - kept)
    before_tokens = len(json.dumps(before)) // 4
    after_tokens = len(json.dumps(after)) // 4
    return {
        "toolsBefore": len(before),
        "toolsAfter": len(after),
        "removed": removed,
        "schemaTokensBefore": before_tokens,
        "schemaTokensAfter": after_tokens,
        "schemaTokensSavedPerRound": before_tokens - after_tokens,
    }
