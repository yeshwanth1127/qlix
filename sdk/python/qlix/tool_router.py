"""Intent-based tool group selection for cloud and hybrid runners."""

from __future__ import annotations

import inspect
import json
import re
from dataclasses import dataclass
from typing import Any, Literal

from .agents3_runtime import is_read_only_file_intent
from .identity import AgentIdentity

ToolGroup = Literal[
    "research", "documents", "web", "files", "code", "gui", "comms", "knowledge", "assessment", "always"
]

GROUP_REQUIRED_SCOPES: dict[ToolGroup, tuple[str, ...]] = {
    "research": ("web.research",),
    "documents": ("files.create",),
    "web": ("web.read", "web.click", "web.transaction"),
    "files": ("system.file_read", "system.file_write"),
    "code": ("system.file_read",),
    "gui": ("system.gui_control",),
    "assessment": (
        "assessment.session.get",
        "assessment.evidence.search",
        "assessment.evidence.read",
        "assessment.artifact.read",
        "assessment.snapshot.read",
        "assessment.snapshot.compare",
        "assessment.framework.read",
        "assessment.record",
        "assessment.review.ask",
        "assessment.review.request_demonstration",
        "assessment.report.create",
    ),
    "comms": (
        "email.read",
        "email.send",
        "drive.read",
        "drive.write",
        "docs.read",
        "docs.write",
        "sheets.read",
        "sheets.write",
        "slides.read",
        "slides.write",
        "forms.read",
        "forms.write",
        "calendar.read",
        "calendar.write",
        "meet.manage",
        "youtube.read",
        "youtube.publish",
        "whatsapp.send",
        "whatsapp.read",
        "whatsapp.contact_send",
        "whatsapp.auto_reply",
        "conversation",
        "crm.read",
        "crm.write",
        "crm.delete",
        "slack.read",
        "slack.send",
        "notion.read",
        "notion.write",
    ),
    "knowledge": ("brain.query", "brain.knowledge_read"),
    "always": (),
}

GROUP_RUNTIMES: dict[ToolGroup, frozenset[str]] = {
    "research": frozenset({"cloud", "hybrid"}),
    "documents": frozenset({"cloud", "hybrid"}),
    "web": frozenset({"cloud"}),
    "files": frozenset({"hybrid"}),
    "code": frozenset({"hybrid"}),
    "gui": frozenset({"hybrid"}),
    "assessment": frozenset({"cloud", "hybrid"}),
    "comms": frozenset({"cloud", "hybrid"}),
    "knowledge": frozenset({"cloud", "hybrid"}),
    "always": frozenset({"cloud", "hybrid"}),
}

# Browser interaction intent — keeps web group when user needs hands, not just eyes.
WEB_INTERACTION_KEYWORDS: frozenset[str] = frozenset(
    {
        "login",
        "sign in",
        "sign-in",
        "fill",
        "submit",
        "checkout",
        "upload",
        "form",
        "navigate to",
        "click",
        "type into",
        "log in",
    }
)

# Internal group ids are jargon to the model ("comms" means nothing to it); describe
# the capability instead so the steer is actually actionable.
_GROUP_LABELS: dict[ToolGroup, str] = {
    "research": "web research tools",
    "documents": "PDF and spreadsheet creation tools",
    "web": "browser tools",
    "files": "local file tools",
    "code": "shell and code tools",
    "gui": "desktop control tools",
    "comms": "messaging and CRM tools",
    "knowledge": "the company knowledge base",
    "assessment": "evidence-based assessment tools",
}

_GROUP_ORDER: tuple[ToolGroup, ...] = (
    "research",
    "documents",
    "web",
    "files",
    "code",
    "gui",
    "comms",
    "knowledge",
    "assessment",
    "always",
)

KEYWORD_MAP: dict[ToolGroup, frozenset[str]] = {
    "research": frozenset(
        {
            "research",
            "competitor",
            "competitors",
            "competitive",
            "competition",
            "competitive analysis",
            "competitive intelligence",
            "market landscape",
            "swot",
            "pricing",
            "rival",
            "deep research",
            "deep dive",
            "调研",
            "learn",
            "learn about",
            "read",
            "read about",
            "read up on",
            "understand",
            "look up",
            "find out",
            "search for",
            "investigate",
            "study",
            "what do people say",
            "reviews",
            "sentiment",
            "twitter",
            "x.com",
            "reddit",
            "bilibili",
            "b站",
            "哔哩哔哩",
            "youtube",
            "github",
            "xiaohongshu",
            "小红书",
            "linkedin",
            "v2ex",
            "rss",
        }
    ),
    "documents": frozenset(
        {
            "pdf",
            "excel",
            "xlsx",
            "spreadsheet",
            "workbook",
            "create a pdf",
            "make a pdf",
            "export pdf",
            "create spreadsheet",
            "make a spreadsheet",
        }
    ),
    "web": frozenset(
        {
            "browse",
            "website",
            "url",
            "google",
            "http",
            "https",
            "web page",
            "scrape",
            "internet",
            "online",
            "login",
            "sign in",
            "sign-in",
            "fill",
            "submit",
            "checkout",
            "upload",
            "form",
            "navigate to",
            "click",
            "log in",
        }
    ),
    "files": frozenset(
        {
            "file",
            "folder",
            "directory",
            "read",
            "write",
            "save",
            "download",
            "csv",
            "json",
            "document",
            "path",
            "open",
            "launch",
            "notepad",
            "explorer",
            "show me",
        }
    ),
    "code": frozenset(
        {
            "script",
            "execute",
            "bash",
            "python",
            "terminal",
            "command",
            "shell",
            "git",
            "pip",
            "npm",
            "run ",
        }
    ),
    "gui": frozenset(
        {
            "open app",
            "click",
            "desktop",
            "excel",
            "figma",
            "quickbooks",
            "screen",
            "application",
            "software",
            "window",
            "type into",
            "spreadsheet",
            "notepad",
            "vscode",
            "vs code",
        }
    ),
    "comms": frozenset(
        {
            "email",
            "gmail",
            "inbox",
            "send mail",
            "reply",
            "outlook",
            "drive",
            "google drive",
            "gdrive",
            "docs",
            "google docs",
            "document",
            "sheets",
            "google sheets",
            "spreadsheet",
            "slides",
            "google slides",
            "presentation",
            "forms",
            "google forms",
            "calendar",
            "google calendar",
            "gcal",
            "schedule",
            "meeting",
            "meet",
            "google meet",
            "gmeet",
            "whatsapp",
            "whats app",
            "zoho",
            "crm",
            "lead",
            "leads",
            "contact",
            "contacts",
            "deal",
            "deals",
            "pipeline",
            "slack",
            "channel",
            "channels",
            "direct message",
            "workspace message",
            "post to slack",
            "slack list",
            "list item",
            "task board",
            "notion",
            "notion page",
            "notion database",
        }
    ),
    "knowledge": frozenset(
        {
            "company",
            "policy",
            "knowledge base",
            "our docs",
            "internal",
            "brain",
            "compliance",
        }
    ),
}


ESCALATION_LADDER_GUIDANCE = (
    "## Tool escalation (research → fetch → browser)\n"
    "Prefer the cheapest sufficient tool:\n"
    "1. research_* / curated APIs for facts and sources.\n"
    "2. If research is thin or blocked, use a lightweight HTTP fetch / open of a specific URL.\n"
    "3. Only then escalate to interactive browser tools (browser / browser_ab_*) for JS-heavy pages, "
    "logins, or multi-step navigation.\n"
    "Do not open the browser first for a simple lookup."
)

_DISCOVERED_TOOL_PREFIXES = ("functions.", "tools.")


def normalize_discovered_tool_name(name: str) -> str:
    """Strip OpenAI-style ``functions.`` / ``tools.`` prefixes from call_tool names."""
    cleaned = (name or "").strip()
    lowered = cleaned.lower()
    for prefix in _DISCOVERED_TOOL_PREFIXES:
        if lowered.startswith(prefix):
            return cleaned[len(prefix) :].strip()
    return cleaned


def invoke_discovered_tool(args_json: str, executor_map: dict[str, Any]) -> str:
    """Execute ``call_tool`` against the live executor map.

    Weak models often pass ``functions.find_tools`` (or ``call_tool`` itself) as the
    discovered name instead of calling the top-level meta-tool. Resolve those aliases
    so the run can continue instead of looping on ``Unknown tool``.
    """
    params = json.loads(args_json) if args_json.strip() else {}
    if not isinstance(params, dict):
        params = {}
    name = normalize_discovered_tool_name(str(params.get("name", "")))
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        arguments = {}
    if not name:
        return "[failed] name is required"
    if name == "call_tool":
        return (
            "[failed] call_tool cannot invoke itself. Pass the discovered tool name, "
            "or call find_tools as a top-level tool. If extracted file content is "
            "already in the prompt, return the final answer without tools."
        )
    if name == "find_tools":
        query = str(arguments.get("query") or "").strip()
        if not query:
            return (
                "[hint] find_tools is a top-level tool — call it directly with "
                '{"query": "..."}. If the task already includes extracted file '
                "content, do not look up tools; return the final answer now."
            )
        find_fn = executor_map.get("find_tools")
        if not find_fn:
            return "[failed] find_tools is not available"
        return find_fn(json.dumps(arguments))
    if name.startswith("browser:"):
        action = name.split(":", 1)[1]
        browser_exec = executor_map.get("browser")
        if not browser_exec:
            return "[failed] browser tool not available"
        payload = {"action": action, **arguments}
        return browser_exec(json.dumps(payload))
    if "." in name and name not in executor_map and not name.startswith("mcp."):
        return (
            f"[failed] {name} is a permission scope, not a tool. Do not call it. "
            "If this dispatch already includes the source data, return the JSON Result now."
        )
    fn = executor_map.get(name)
    if not fn:
        return f"[failed] Unknown tool: {name}. Use find_tools first."
    if inspect.iscoroutinefunction(fn):
        return (
            f"[failed] {name} must be called as a top-level tool, not via call_tool. "
            "If this dispatch does not need tools, return the final JSON Result now."
        )
    result = fn(json.dumps(arguments))
    if inspect.isawaitable(result):
        return (
            f"[failed] {name} returned an async result via call_tool. "
            "Call it as a top-level tool, or return the final answer without tools."
        )
    return str(result)


@dataclass(frozen=True)
class ToolRouterResult:
    """Plan for one run.

    ``groups`` is the keyword-intent classification. It no longer decides WHICH tools
    are offered — only what the run-context block nudges the model toward. The tool
    array is built from ``scope_groups``, which depends solely on granted scopes,
    runtime and skill filter, so it is identical for every run of an agent and can be
    served from the model provider's cached prompt prefix.
    """

    groups: tuple[ToolGroup, ...]
    instruction: str
    skill_filter: list[str] | None
    guidance: str = ""
    scope_groups: tuple[ToolGroup, ...] = ()
    read_only_intent: bool = False


def _granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def _group_allowed(group: ToolGroup, identity: AgentIdentity, runner_runtime: str) -> bool:
    if runner_runtime not in GROUP_RUNTIMES.get(group, frozenset()):
        return False
    required = GROUP_REQUIRED_SCOPES.get(group, ())
    if not required:
        return True
    granted = _granted_scopes(identity)
    return any(s in granted for s in required)


def _has_web_interaction_intent(text: str) -> bool:
    return any(kw in text for kw in WEB_INTERACTION_KEYWORDS)


def _granted_scope_set(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def has_crm_scope(identity: AgentIdentity) -> bool:
    granted = _granted_scope_set(identity)
    return any(s.startswith("crm.") for s in granted)


def has_slack_scope(identity: AgentIdentity) -> bool:
    granted = _granted_scope_set(identity)
    return "slack.read" in granted or "slack.send" in granted


def is_slack_api_intent(text: str) -> bool:
    lower = text.lower()
    if "slack" in lower:
        return True
    if any(w in lower for w in ("project tracker", "slack list", "list item", "tracker task")):
        return True
    if any(
        phrase in lower
        for phrase in (
            "its status",
            "it's status",
            "that task",
            "this task",
            "mark it",
            "complete it",
            "reopen it",
            "delete it",
            "change its",
        )
    ):
        return True
    if "channel" in lower or "channels" in lower:
        return any(w in lower for w in ("slack", "workspace", "dm", "message", "post", "tracker", "todo", "list"))
    return False


def slack_run_guidance() -> str:
    return (
        "## Slack (this run)\n"
        "Create: slack_create_list_item(channel=\"todo\", title=\"...\"). "
        "Update: slack_update_list_item(channel=\"todo\", taskTitle=\"...\", status=\"In progress\"). "
        "List/search: slack_list_list_items(channel=\"todo\", query=\"...\"). "
        "Complete/reopen: slack_set_list_task_completion(channel=\"todo\", taskTitle=\"...\", completed=true). "
        "Delete only after explicit request: slack_delete_list_item(channel=\"todo\", taskTitle=\"...\"). "
        "Use Active Slack task context for pronouns such as 'it' only when it is present; never guess ids."
    )


CRM_MUTATION_KEYWORDS: frozenset[str] = frozenset(
    {
        "add a lead",
        "add lead",
        "add a new lead",
        "create a lead",
        "create lead",
        "new lead",
        "add a contact",
        "create a contact",
        "new contact",
        "add a deal",
        "create a deal",
        "update lead",
        "update contact",
        "update crm",
        "zoho crm",
        "in crm",
        "to crm",
    }
)


def is_crm_mutation_intent(text: str) -> bool:
    """True when the user wants to create/update/delete a CRM record."""
    lower = text.lower()
    return any(kw in lower for kw in CRM_MUTATION_KEYWORDS)


def crm_jit_run_guidance() -> str:
    return (
        "## CRM actions (this run)\n"
        "When the user asks to add, create, update, or delete a CRM record (Lead, Contact, Deal, etc.), "
        "call the matching CRM tool immediately (e.g. crm_create with module Leads and the fields they provided). "
        "Do NOT tell them to check the dashboard or wait for approval first.\n"
        "If the action requires approval, an Approve/Deny card appears in this chat — the run pauses until "
        "they choose. After they approve once, later CRM writes/deletes in this conversation proceed automatically.\n"
        "Use crm_describe_module if you need Zoho field API names. For a single person with name and phone, "
        "use module Leads with Last_Name, First_Name, Phone (or Mobile) as appropriate."
    )


def crm_no_invent_guidance() -> str:
    """Steer CRM-capable agents away from inventing writes when the user didn't ask."""
    return (
        "## CRM tools (available but not requested)\n"
        "You have CRM tools, but this request does NOT ask to create, update, or delete CRM records. "
        "Do NOT call crm_create, crm_update, crm_delete, crm_bulk_create, convert, or link tools. "
        "Do not invent CRM side work (e.g. saving filtered leads into Zoho) unless the user explicitly asks. "
        "If you only need to filter or transform leads for the next pipeline stage, keep the result in your "
        "findings / returned JSON — do not write to CRM."
    )


def has_forms_scope(identity: AgentIdentity) -> bool:
    granted = _granted_scope_set(identity)
    return "forms.read" in granted or "forms.write" in granted


FORMS_MUTATION_KEYWORDS: frozenset[str] = frozenset(
    {
        "create a form",
        "create form",
        "make a form",
        "make form",
        "new form",
        "build a form",
        "build form",
        "google form",
        "google forms",
        "add a question",
        "add question",
        "update the form",
        "update form",
        "rebuild the form",
        "rebuild form",
        "recreate the form",
        "recreate form",
    }
)


def is_forms_mutation_intent(text: str) -> bool:
    """True when the user wants to create/update a Google Form."""
    lower = text.lower()
    return any(kw in lower for kw in FORMS_MUTATION_KEYWORDS)


def forms_reuse_guidance() -> str:
    """Steer Forms-capable agents to surface links and avoid recreate-on-follow-up."""
    return (
        "## Google Forms (reuse prior results)\n"
        "After forms_write action='create' (or forms_read action='get'), always give the user "
        "responderUri as the shareable respondent link, plus formId.\n"
        "For link-only follow-ups (\"shareable link\", \"send the link\", \"where is the form\"): "
        "answer from recent conversation/memory first; if the link is missing but formId is known, "
        "call forms_read action='get' once. Do NOT create a new form unless the user explicitly "
        "asks to create, rebuild, or recreate one."
    )


def scope_groups(
    identity: AgentIdentity,
    *,
    runner_runtime: str,
    skill_filter: list[str] | None = None,
) -> tuple[ToolGroup, ...]:
    """Groups derived from granted scopes + runtime ONLY — no keyword intent.

    This is what decides the tool array. Because it ignores the prompt, the array is
    identical for every run of an agent, so the provider can serve the tool schema
    (the largest fixed cost, re-sent on every round) from its cached prompt prefix.

    Intent still matters, but it now steers the model through ``tool_preference_text``
    instead of removing tools from the schema. Keyword-based removal saved ~1.2k tokens
    on a good run and cost 100% of cache hits on every run — a bad trade — and it made
    tool availability non-deterministic for the same agent.

    ``skill_filter`` is honoured because it is an explicit user selection, not a guess.
    It yields one extra stable variant per distinct selection.
    """
    selected: set[ToolGroup] = set()
    filt = {str(s).strip() for s in (skill_filter or []) if str(s).strip()} or None
    scoped_filter = bool(filt and any("." in s for s in filt))
    granted = _granted_scopes(identity)

    for group in _GROUP_ORDER:
        if not _group_allowed(group, identity, runner_runtime):
            continue
        if scoped_filter and group != "always":
            required = GROUP_REQUIRED_SCOPES.get(group, ())
            if not any(s in filt and s in granted for s in required):
                continue
        selected.add(group)

    selected.add("always")
    return tuple(g for g in _GROUP_ORDER if g in selected)


def tool_preference_text(
    intent_groups: tuple[ToolGroup, ...],
    available: tuple[ToolGroup, ...],
    *,
    read_only: bool,
) -> str:
    """TIER B nudge replacing what keyword-based tool removal used to do implicitly.

    Every scoped tool stays callable; this just tells the model which ones fit the
    task, and hard-forbids writes on a read-only request. Costs ~20-60 tokens once per
    run instead of invalidating a multi-thousand-token cached prefix.
    """
    lines: list[str] = []
    preferred = [
        _GROUP_LABELS.get(g, g) for g in intent_groups if g in available and g != "always"
    ]
    if preferred:
        lines.append(
            "Most relevant for this request: "
            + ", ".join(preferred)
            + ". Prefer those; do not expand into unrelated side work with other tools."
        )
    else:
        lines.append(
            "This looks like a conversational or follow-up message rather than a new "
            "tool task. Reply directly from recent conversation/memory when you can. "
            "Do not invent side work with available tools."
        )
    if "research" in available:
        if "research" in intent_groups and "web" not in intent_groups:
            lines.append(
                "Use research_* tools for read/search tasks here; do not open the "
                "browser for a simple lookup."
            )
        elif "research" in intent_groups and "web" in intent_groups:
            lines.append(
                "Use research_* tools for read/search on known platforms (Twitter, "
                "GitHub, YouTube, Bilibili, Exa). Use browser_* only for login, forms, "
                "or when research_* returns blocked."
            )
    # `read_only` comes from is_read_only_file_intent, which detects intent about
    # FILES. Only say this when local file/code tools are actually loaded — otherwise
    # a Slack or CRM agent asked "what are my open tasks?" (the verb "open" matches)
    # would be told its write tools are blocked, and may refuse to create a task.
    if read_only and any(g in available for g in ("files", "code")):
        lines.append(
            "This request is read-only with respect to local files: inspect and report, "
            "but do NOT create, modify, overwrite or delete any file, and do not run "
            "shell commands that change state. Local file-write tools are blocked for "
            "this run and will return an error. This does not restrict non-file tools."
        )
    return "\n".join(lines)


def classify_groups(
    instruction: str,
    identity: AgentIdentity,
    *,
    runner_runtime: str,
    skill_filter: list[str] | None = None,
) -> tuple[ToolGroup, ...]:
    """Keyword classifier + scope intersection. Fixed for the whole run."""
    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if filt == {"team.dispatch"}:
            return tuple(g for g in _GROUP_ORDER if g == "always")
        if filt and any("." in s for s in filt):
            selected: set[ToolGroup] = set()
            granted = _granted_scopes(identity)
            for group, scopes in GROUP_REQUIRED_SCOPES.items():
                if group == "always":
                    continue
                if runner_runtime not in GROUP_RUNTIMES.get(group, frozenset()):
                    continue
                if any(s in filt and s in granted for s in scopes):
                    selected.add(group)
            if not selected and "web.read" in filt:
                selected.add("web")
            if not selected and "web.research" in filt:
                selected.add("research")
            if not selected and "files.create" in filt:
                selected.add("documents")
            selected.add("always")
            return tuple(g for g in _GROUP_ORDER if g in selected)

    text = instruction.lower()
    scores: dict[ToolGroup, int] = {g: 0 for g in KEYWORD_MAP}
    for group, keywords in KEYWORD_MAP.items():
        for kw in keywords:
            if kw in text:
                scores[group] += 1

    selected = {g for g, score in scores.items() if score > 0}
    if not selected:
        if runner_runtime == "hybrid":
            selected = {"files"} if is_read_only_file_intent(instruction) else {"files", "code"}
        # Cloud: no keyword and no steer from the agent's description -> don't assume the
        # user wants to browse. Offer only the always-on tools (think/done) so plain chat
        # / greetings don't spin up the browser. Real browse requests match `web` keywords
        # (or the agent's description does) and load web tools then.

    # Passive research (platform names, 调研, etc.) should not load the full browser suite —
    # UNLESS the agent was explicitly granted web.read (e.g. competitor research), where the
    # browser is a silent fallback for blocked platform APIs.
    if "research" in selected:
        research_has_browser = "web.read" in _granted_scopes(identity) and _group_allowed(
            "web", identity, runner_runtime
        )
        if research_has_browser:
            selected.add("web")
        elif not _has_web_interaction_intent(text):
            selected.discard("web")

    if runner_runtime == "hybrid" and "comms" in selected:
        # Email-on-hybrid shouldn't drag the browser in, but WhatsApp file delivery
        # is commonly paired with a browser screenshot/PDF — keep web in that case.
        if not any(kw in text for kw in ("whatsapp", "whats app")):
            selected.discard("web")

    # Slack API tools live under comms (cloud + hybrid). "slack" used to match gui only,
    # which loads nothing on cloud runners — so channel/list questions got only find_tools.
    if has_slack_scope(identity) and is_slack_api_intent(text):
        if _group_allowed("comms", identity, runner_runtime):
            selected.add("comms")

    final: list[ToolGroup] = []
    for g in _GROUP_ORDER:
        if g == "always" or g in selected:
            if _group_allowed(g, identity, runner_runtime):
                final.append(g)

    if "always" not in final:
        final.append("always")

    return tuple(final)


class ToolRouter:
    def __init__(
        self,
        identity: AgentIdentity,
        *,
        runner_runtime: str,
    ) -> None:
        self.identity = identity
        self.runner_runtime = runner_runtime
        #: Set by build_tool_definitions when the budget dropped anything, so the
        #: runner can emit it as telemetry. None when nothing was removed.
        self.last_budget_report: dict[str, Any] | None = None
        self.last_has_context_refs = False
        self.last_enable_context_search = False

    def plan_run(
        self,
        instruction: str,
        skill_filter: list[str] | None = None,
        *,
        context: str = "",
    ) -> ToolRouterResult:
        """Plan tool groups for a run.

        ``context`` is the agent's standing description (set at creation via the AI
        builder or manually). It is the trustworthy source of intent — a per-run
        prompt cannot always be relied on — so it is combined with the prompt when
        deciding which tool groups and write/deliverable tools to offer. For
        example, a description of "generate a PDF and send it on WhatsApp" keeps the
        create/send tools available even if the prompt only says "go".
        """
        routing_text = f"{instruction}\n{context}".strip() if context.strip() else instruction
        groups = classify_groups(
            routing_text,
            self.identity,
            runner_runtime=self.runner_runtime,
            skill_filter=skill_filter,
        )
        guidance_parts: list[str] = []
        if "research" in groups and "web" in groups:
            guidance_parts.append(ESCALATION_LADDER_GUIDANCE)
        if "comms" in groups and has_crm_scope(self.identity):
            if is_crm_mutation_intent(routing_text):
                guidance_parts.append(crm_jit_run_guidance())
            else:
                guidance_parts.append(crm_no_invent_guidance())
        if has_forms_scope(self.identity):
            # Always remind Forms agents to surface responderUri / reuse; create is fine
            # when mutation intent is present, but recreate-on-follow-up is not.
            guidance_parts.append(forms_reuse_guidance())
        if "comms" in groups and has_slack_scope(self.identity) and is_slack_api_intent(routing_text):
            guidance_parts.append(slack_run_guidance())
        if "comms" in groups and "email.send" in (
            set(self.identity.permission_scopes) | set(self.identity.always_scopes)
        ):
            from .cloud_email_runtime import email_mode_routing_guidance

            email_guidance = email_mode_routing_guidance(routing_text)
            if email_guidance:
                guidance_parts.append(email_guidance)
        guidance = "\n\n".join(guidance_parts)
        # The tool array comes from scopes alone so it is byte-stable across runs and
        # can be served from the provider's cached prefix; `groups` above now only
        # steers the model via the run-context block.
        available = scope_groups(
            self.identity,
            runner_runtime=self.runner_runtime,
            skill_filter=skill_filter,
        )
        return ToolRouterResult(
            groups=groups,
            instruction=routing_text,
            skill_filter=skill_filter,
            guidance=guidance,
            scope_groups=available,
            read_only_intent=is_read_only_file_intent(instruction),
        )

    def tool_preference(self, plan: ToolRouterResult) -> str:
        """Tier B text that replaces intent-based tool removal."""
        return tool_preference_text(
            plan.groups,
            plan.scope_groups or plan.groups,
            read_only=plan.read_only_intent,
        )

    def build_tool_definitions(
        self,
        plan: ToolRouterResult,
        mcp_servers: Any = None,
        *,
        tool_profile: str = "full",
        askable_agents: list[dict[str, Any]] | None = None,
        has_context_refs: bool = False,
        enable_context_search: bool = False,
    ) -> list[dict[str, Any]]:
        self.last_has_context_refs = has_context_refs
        self.last_enable_context_search = enable_context_search
        from .cloud_browser_runtime import openai_browser_tool_definitions
        from .cloud_document_runtime import openai_document_tool_definitions
        from .cloud_email_runtime import openai_email_tool_definitions
        from .cloud_crm_runtime import openai_crm_tool_definitions
        from .cloud_slack_runtime import openai_slack_tool_definitions
        from .cloud_notion_runtime import openai_notion_tool_definitions
        from .cloud_research_runtime import openai_research_tool_definitions
        from .cloud_whatsapp_runtime import openai_whatsapp_tool_definitions
        from .agents3_runtime import openai_agents3_tool_definitions
        from .local_tool_definitions import (
            openai_always_tool_definitions,
            openai_knowledge_tool_definitions,
        )
        from .team_context_runtime import openai_team_context_tool_definitions

        tools: list[dict[str, Any]] = []
        sf = plan.skill_filter if plan.skill_filter else None
        # Scope-derived, NOT keyword-derived: same agent -> same array -> cache hit.
        groups = plan.scope_groups or plan.groups

        if "research" in groups:
            tools.extend(openai_research_tool_definitions(self.identity, sf))
        if "documents" in groups:
            tools.extend(openai_document_tool_definitions(self.identity, sf))
        if "web" in groups:
            tools.extend(openai_browser_tool_definitions(self.identity, sf))
        if self.runner_runtime == "hybrid" and any(
            g in groups for g in ("files", "code", "gui")
        ):
            tools.extend(
                openai_agents3_tool_definitions(
                    self.identity,
                    groups=groups,
                    skill_filter=sf,
                    # No instruction: read-only narrowing would make the schema
                    # prompt-dependent. It is enforced in the executor instead.
                    instruction=None,
                )
            )
        if "comms" in groups:
            tools.extend(openai_email_tool_definitions(self.identity, sf))
            from .cloud_google_workspace_runtime import (
                openai_google_workspace_tool_definitions,
            )

            tools.extend(openai_google_workspace_tool_definitions(self.identity, sf))
            tools.extend(openai_crm_tool_definitions(self.identity, sf))
            tools.extend(openai_slack_tool_definitions(self.identity, sf))
            tools.extend(openai_notion_tool_definitions(self.identity, sf))
            tools.extend(openai_whatsapp_tool_definitions(self.identity, sf))
            from .cloud_conversation_runtime import openai_conversation_tool_definitions

            tools.extend(openai_conversation_tool_definitions(self.identity, sf))
        if "knowledge" in groups:
            tools.extend(openai_knowledge_tool_definitions(self.identity, sf))
            from .cloud_brain_file_runtime import openai_brain_file_tool_definitions

            tools.extend(openai_brain_file_tool_definitions(self.identity, sf))
        if "assessment" in groups:
            from .assessment_runtime import openai_assessment_tool_definitions

            tools.extend(openai_assessment_tool_definitions(self.identity, sf))
        if "always" in groups:
            tools.extend(openai_always_tool_definitions(askable_agents))
        tools.extend(openai_team_context_tool_definitions(
            sf,
            enable=has_context_refs,
            enable_search=enable_context_search,
        ))

        if mcp_servers:
            from .cloud_mcp_runtime import openai_mcp_tool_definitions

            tools.extend(
                openai_mcp_tool_definitions(
                    self.identity,
                    mcp_servers,
                    sf,
                    runner_runtime=self.runner_runtime,
                )
            )

        # The catalog is now the live, stable source for managed tool metadata.
        # It intentionally leaves dynamic MCP/product extensions intact.
        from .capability_catalog import canonicalize_tool_definitions
        tools = canonicalize_tool_definitions(tools)

        # Applied last, to the assembled list, so one policy covers every group —
        # built-in, connector and MCP alike. Inputs are agent-level only, so the
        # result stays byte-stable per agent and the cached prefix survives.
        from .tool_budget import apply_tool_budget

        self.last_budget_report = None
        budgeted = apply_tool_budget(
            tools,
            tool_profile=tool_profile,
            has_mcp_servers=bool(mcp_servers),
        )
        if len(budgeted) != len(tools):
            from .tool_budget import budget_report

            self.last_budget_report = budget_report(tools, budgeted)
        return budgeted

    def build_executor_map(
        self,
        plan: ToolRouterResult,
        *,
        agent_id: str = "",
        run_id: str = "",
        backend_url: str = "",
        runner_token: str = "",
        qlix_sdk: Any = None,
        run_cache: dict[str, str] | None = None,
        on_gui_frame: Any = None,
        agents3_context: Any = None,
        mcp_servers: Any = None,
        subagent_context: Any = None,
        live_tools: list[dict[str, Any]] | None = None,
        team_id: str | None = None,
        live_executors: dict[str, callable] | None = None,
        has_context_refs: bool = False,
        enable_context_search: bool = False,
    ) -> dict[str, callable]:
        import json

        from .cloud_browser_runtime import (
            openai_browser_tool_definitions,
            resolve_tool_name,
            _use_agent_browser_suite,
            _remap_legacy_params,
            _effective_granted_scopes,
        )
        from .cloud_document_runtime import build_document_tool_executors
        from .cloud_email_runtime import build_email_tool_executors
        from .cloud_crm_runtime import build_crm_tool_executors
        from .cloud_research_runtime import build_research_tool_executors
        from .cloud_whatsapp_runtime import build_whatsapp_tool_executors
        from .agents3_runtime import build_agents3_executors
        from .luna.core.registry import ToolRegistry

        executor_map: dict[str, callable] = live_executors if live_executors is not None else {}
        # When refreshing into an existing live map, clear managed keys first so stale
        # tools from prior scopes do not linger. Preserve _qlix_* hooks.
        if live_executors is not None:
            preserved_hooks = {
                k: v
                for k, v in list(executor_map.items())
                if isinstance(k, str) and k.startswith("_qlix_")
            }
            executor_map.clear()
            executor_map.update(preserved_hooks)
        sf = plan.skill_filter
        # Must mirror build_tool_definitions exactly, or a tool appears in the
        # schema with no executor behind it.
        groups = plan.scope_groups or plan.groups

        if "research" in groups:
            executor_map.update(
                build_research_tool_executors(
                    identity=self.identity,
                    skill_filter=sf,
                    qlix_sdk=qlix_sdk,
                )
            )
        if "documents" in groups:
            executor_map.update(
                build_document_tool_executors(
                    identity=self.identity,
                    skill_filter=sf,
                    agent_id=agent_id,
                    run_id=run_id,
                    backend_url=backend_url,
                    runner_token=runner_token,
                )
            )

        if "web" in groups:
            from .browser_failover import run_agent_browser_tool_with_failover
            from .cloud_browser_runtime import (
                browser_collapse_enabled,
                resolve_browser_action,
            )

            scopes = _effective_granted_scopes(self.identity)
            tools_list = openai_browser_tool_definitions(self.identity, sf)

            # Always register collapsed `browser` executor when collapse is on
            # (even if definition list is empty due to filters — runner_common may call it).
            if browser_collapse_enabled():

                def _execute_browser(args_json: str, scps=scopes):
                    params = json.loads(args_json) if args_json.strip() else {}
                    if not isinstance(params, dict):
                        params = {}
                    action = str(params.pop("action", "") or "").strip()
                    resolved = resolve_browser_action(action)
                    if not resolved:
                        return f"[failed] Unknown browser action: {action or '(empty)'}"
                    # Map query → what/text for extract convenience
                    if action.lower() in ("extract", "get") and params.get("query") and not params.get("what"):
                        params.setdefault("text", params.get("query"))
                    ok, content = run_agent_browser_tool_with_failover(
                        resolved, params, granted_scopes=scps
                    )
                    return ("" if ok else "[failed] ") + content

                executor_map["browser"] = _execute_browser

            for tool_def in tools_list:
                tool_name = tool_def["function"]["name"]
                if tool_name == "browser":
                    continue  # already registered
                original_name = tool_name
                resolved_name = resolve_tool_name(tool_name)
                use_ab = (
                    _use_agent_browser_suite()
                    and (
                        resolved_name.startswith("browser_ab_")
                        or resolved_name == "browser_exec"
                    )
                )
                if use_ab:

                    def _make_ab(name, scps):
                        def _execute(args_json: str):
                            params = json.loads(args_json) if args_json.strip() else {}
                            if not isinstance(params, dict):
                                params = {}
                            ok, content = run_agent_browser_tool_with_failover(
                                name, params, granted_scopes=scps
                            )
                            return ("" if ok else "[failed] ") + content

                        return _execute

                    executor_map[original_name] = _make_ab(resolved_name, scopes)
                else:
                    try:
                        tool_cls = ToolRegistry.get(resolved_name)
                        tool_instance = tool_cls()
                    except KeyError:
                        def _err(n=original_name):
                            return lambda _a: f"Unknown tool: {n}"

                        executor_map[original_name] = _err()
                        continue

                    def _make_legacy(inst, orig, resolved):
                        def _execute(args_json: str):
                            params = json.loads(args_json) if args_json.strip() else {}
                            if not isinstance(params, dict):
                                params = {}
                            if orig != resolved:
                                params = _remap_legacy_params(orig, resolved, params)
                            result = inst.execute(**params)
                            return ("" if result.success else "[failed] ") + (result.content or "")

                        return _execute

                    executor_map[original_name] = _make_legacy(
                        tool_instance, original_name, resolved_name
                    )

        if self.runner_runtime == "hybrid" and any(
            g in groups for g in ("files", "code", "gui")
        ):
            executor_map.update(
                build_agents3_executors(
                    self.identity,
                    groups=groups,
                    qlix_sdk=qlix_sdk,
                    skill_filter=sf,
                    agents3_context=agents3_context,
                    # Write tools stay in the schema (so the cached prefix is stable)
                    # but are refused at execution time on a read-only request.
                    read_only_run=plan.read_only_intent,
                )
            )

        if "comms" in groups and agent_id and run_id and backend_url and runner_token:
            email_executors = build_email_tool_executors(
                identity=self.identity,
                skill_filter=sf,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
                qlix_sdk=qlix_sdk,
            )
            executor_map.update(email_executors)
            from .cloud_google_workspace_runtime import (
                build_google_workspace_tool_executors,
            )

            google_executors = build_google_workspace_tool_executors(
                identity=self.identity,
                skill_filter=sf,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
                qlix_sdk=qlix_sdk,
            )
            executor_map.update(google_executors)
            crm_executors = build_crm_tool_executors(
                identity=self.identity,
                skill_filter=sf,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
                qlix_sdk=qlix_sdk,
            )
            executor_map.update(crm_executors)
            from .cloud_slack_runtime import build_slack_tool_executors

            slack_executors = build_slack_tool_executors(
                identity=self.identity,
                skill_filter=sf,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
                qlix_sdk=qlix_sdk,
            )
            executor_map.update(slack_executors)
            from .cloud_notion_runtime import build_notion_tool_executors

            notion_executors = build_notion_tool_executors(
                identity=self.identity,
                skill_filter=sf,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
                qlix_sdk=qlix_sdk,
            )
            executor_map.update(notion_executors)
            whatsapp_executors = build_whatsapp_tool_executors(
                identity=self.identity,
                skill_filter=sf,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
                qlix_sdk=qlix_sdk,
            )
            executor_map.update(whatsapp_executors)
            from .cloud_conversation_runtime import build_conversation_tool_executors

            executor_map.update(
                build_conversation_tool_executors(
                    identity=self.identity,
                    skill_filter=sf,
                    agent_id=agent_id,
                    run_id=run_id,
                    backend_url=backend_url,
                    runner_token=runner_token,
                )
            )

        if "assessment" in groups and agent_id and run_id and backend_url and runner_token:
            from .assessment_runtime import build_assessment_tool_executors

            executor_map.update(
                build_assessment_tool_executors(
                    identity=self.identity,
                    skill_filter=sf,
                    agent_id=agent_id,
                    run_id=run_id,
                    backend_url=backend_url,
                    runner_token=runner_token,
                )
            )

        if agent_id and run_id and backend_url and runner_token:
            from .team_context_runtime import build_team_context_tool_executors

            executor_map.update(
                build_team_context_tool_executors(
                    skill_filter=sf,
                    agent_id=agent_id,
                    run_id=run_id,
                    backend_url=backend_url,
                    runner_token=runner_token,
                    enable=has_context_refs,
                    enable_search=enable_context_search,
                )
            )

        if "knowledge" in groups:
            def _brain_stub(_args: str) -> str:
                return "Company brain context is prepended to the user message for this run."

            executor_map.setdefault("brain_query", _brain_stub)
            from .cloud_brain_file_runtime import build_brain_file_tool_executors

            executor_map.update(
                build_brain_file_tool_executors(
                    identity=self.identity,
                    skill_filter=sf,
                    agent_id=agent_id,
                    run_id=run_id,
                    backend_url=backend_url,
                    runner_token=runner_token,
                )
            )

        if "always" in groups:
            def _think(args_json: str) -> str:
                return "Thought recorded."

            def _done(args_json: str) -> str:
                return "Task marked complete."

            # Catalog for find_tools — includes collapsed browser actions + registered executors.
            catalog: list[tuple[str, str]] = []
            for name in sorted(executor_map.keys()):
                catalog.append((name, f"Registered tool {name}"))
            try:
                from .cloud_browser_runtime import _BROWSER_ACTION_MAP

                for action, tid in sorted(_BROWSER_ACTION_MAP.items()):
                    catalog.append((f"browser:{action}", f"Browser action → {tid}"))
            except Exception:
                pass
            if mcp_servers:
                for srv in mcp_servers if isinstance(mcp_servers, list) else []:
                    tools = getattr(srv, "tools", None) or (srv.get("tools") if isinstance(srv, dict) else None) or []
                    slug = getattr(srv, "slug", None) or (srv.get("slug") if isinstance(srv, dict) else "mcp")
                    for t in tools:
                        tname = getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else None)
                        tdesc = getattr(t, "description", None) or (t.get("description") if isinstance(t, dict) else "")
                        if tname:
                            catalog.append((f"mcp.{slug}.{tname}", str(tdesc or "")[:200]))

            def _find_tools(args_json: str, cat=catalog) -> str:
                params = json.loads(args_json) if args_json.strip() else {}
                query = str(params.get("query", "")).strip().lower()
                limit = int(params.get("limit") or 15)
                if not query:
                    return "query is required"
                hits = [
                    f"- {name}: {desc}"
                    for name, desc in cat
                    if query in name.lower() or query in desc.lower()
                ][: max(1, min(limit, 40))]
                return "\n".join(hits) if hits else "No matching tools."

            def _call_tool(args_json: str, emap=executor_map) -> str:
                return invoke_discovered_tool(args_json, emap)

            def _delegate_task(
                args_json: str,
                *,
                _agent_id=agent_id,
                _run_id=run_id,
                _backend=backend_url,
                _token=runner_token,
            ) -> str:
                params = json.loads(args_json) if args_json.strip() else {}
                prompt = str(params.get("prompt", "")).strip()
                if not prompt:
                    return "[failed] prompt is required"
                if not (_agent_id and _run_id and _backend and _token):
                    return "[failed] delegate_task unavailable in this runner context"
                import urllib.request

                body = json.dumps(
                    {
                        "prompt": prompt,
                        "skills": params.get("skills") or [],
                        "parentRunId": _run_id,
                    }
                ).encode("utf-8")
                req = urllib.request.Request(
                    f"{_backend.rstrip('/')}/api/v1/agents/{_agent_id}/runs/delegate",
                    data=body,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {_token}",
                    },
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        raw = resp.read().decode("utf-8")
                    return f"Delegated: {raw}"
                except Exception as exc:
                    return f"[failed] delegate_task: {exc}"

            async def _request_capability(
                args_json: str,
                *,
                _agent_id=agent_id,
                _run_id=run_id,
                _backend=backend_url,
                _token=runner_token,
                _team_id=team_id,
                _live_tools=live_tools,
                _plan=plan,
                _router=self,
                _mcp=mcp_servers,
                _sdk=qlix_sdk,
                _sub=subagent_context,
                _emap=executor_map,
            ) -> str:
                params = json.loads(args_json) if args_json.strip() else {}
                scopes_raw = params.get("scopes") or []
                if isinstance(scopes_raw, str):
                    scopes_list = [scopes_raw]
                elif isinstance(scopes_raw, list):
                    scopes_list = [str(s).strip() for s in scopes_raw if str(s).strip()]
                else:
                    scopes_list = []
                reason = str(params.get("reason") or "").strip() or (
                    "Needed for the current user request"
                )
                if not scopes_list:
                    return "[failed] scopes is required (e.g. [\"email.send\"])"
                if not (_agent_id and _backend and _token):
                    return "[failed] request_capability unavailable in this runner context"

                from .capability_grant import request_capability_and_wait

                result = await request_capability_and_wait(
                    agent_id=_agent_id,
                    runner_token=_token,
                    backend_url=_backend,
                    scopes=scopes_list,
                    reason=reason,
                    run_id=_run_id or None,
                    team_id=_team_id,
                )
                status = str(result.get("status") or "")
                if status != "approved":
                    err = str(result.get("error") or "").strip()
                    if status == "denied":
                        return (
                            "[failed] User declined to add the requested capability"
                            + (f": {err}" if err else "")
                            + ". Do not claim you can do it; offer another approach."
                        )
                    if status == "expired":
                        return (
                            "[failed] Capability request expired before the user answered"
                            + (f": {err}" if err else "")
                            + ". Ask them again only if they still want this."
                        )
                    return f"[failed] Capability grant failed ({status}): {err or 'unknown'}"

                granted = result.get("grantedScopes") or scopes_list
                if not isinstance(granted, list):
                    granted = scopes_list

                # Hot-reload tools for the rest of this run.
                try:
                    from dataclasses import replace as dc_replace

                    perm = result.get("permissionScopes")
                    jit = result.get("jitScopes")
                    always = result.get("alwaysScopes")
                    if isinstance(perm, list) and perm:
                        _router.identity = dc_replace(
                            _router.identity,
                            permission_scopes=tuple(str(s) for s in perm if str(s).strip()),
                            jit_scopes=tuple(
                                str(s) for s in (jit if isinstance(jit, list) else []) if str(s).strip()
                            )
                            or _router.identity.jit_scopes,
                            always_scopes=tuple(
                                str(s)
                                for s in (always if isinstance(always, list) else [])
                                if str(s).strip()
                            )
                            or _router.identity.always_scopes,
                        )
                    else:
                        _router.identity = dc_replace(
                            _router.identity,
                            permission_scopes=tuple(
                                dict.fromkeys(
                                    [
                                        *(_router.identity.permission_scopes or ()),
                                        *(str(s) for s in granted if str(s).strip()),
                                    ]
                                )
                            ),
                        )

                    refresh_plan = _plan
                    if _plan.skill_filter:
                        expanded = list(
                            dict.fromkeys([*_plan.skill_filter, *(str(s) for s in granted)])
                        )
                        refresh_plan = dc_replace(
                            _plan,
                            skill_filter=expanded,
                            groups=classify_groups(
                                "",
                                _router.identity,
                                runner_runtime=_router.runner_runtime,
                                skill_filter=expanded,
                            ),
                            scope_groups=scope_groups(
                                _router.identity,
                                runner_runtime=_router.runner_runtime,
                                skill_filter=expanded,
                            ),
                        )
                    else:
                        refresh_plan = dc_replace(
                            _plan,
                            scope_groups=scope_groups(
                                _router.identity,
                                runner_runtime=_router.runner_runtime,
                                skill_filter=None,
                            ),
                        )

                    new_tools = _router.build_tool_definitions(
                        refresh_plan,
                        _mcp,
                        askable_agents=None,
                        has_context_refs=_router.last_has_context_refs,
                        enable_context_search=_router.last_enable_context_search,
                    )
                    # Rebuild into the live executor map so later grants keep mutating it.
                    _router.build_executor_map(
                        refresh_plan,
                        agent_id=_agent_id,
                        run_id=_run_id,
                        backend_url=_backend,
                        runner_token=_token,
                        qlix_sdk=_sdk,
                        mcp_servers=_mcp,
                        subagent_context=_sub,
                        live_tools=_live_tools,
                        team_id=_team_id,
                        live_executors=_emap,
                        has_context_refs=_router.last_has_context_refs,
                        enable_context_search=_router.last_enable_context_search,
                    )
                    if _live_tools is not None:
                        _live_tools.clear()
                        _live_tools.extend(new_tools)
                except Exception as exc:  # noqa: BLE001
                    return (
                        f"Capability added ({', '.join(map(str, granted))}), but tool refresh "
                        f"failed ({exc}). Continue — tools will be available on the next message."
                    )

                return (
                    "User approved adding capability: "
                    + ", ".join(map(str, granted))
                    + ". The new tools are available now — continue the original task."
                )

            executor_map.setdefault("think", _think)
            executor_map.setdefault("done", _done)
            executor_map.setdefault("find_tools", _find_tools)
            executor_map.setdefault("call_tool", _call_tool)
            executor_map.setdefault("delegate_task", _delegate_task)
            executor_map.setdefault("request_capability", _request_capability)

            if subagent_context is not None:
                from .subagents import build_subagent_executors

                executor_map.update(build_subagent_executors(subagent_context))

        if mcp_servers and qlix_sdk is not None:
            from .cloud_mcp_runtime import build_mcp_tool_executors

            executor_map.update(
                build_mcp_tool_executors(
                    identity=self.identity,
                    qlix_sdk=qlix_sdk,
                    mcp_servers=mcp_servers,
                    runner_runtime=self.runner_runtime,
                    skill_filter=sf,
                    backend_url=backend_url,
                    runner_token=runner_token,
                    agent_id=agent_id,
                )
            )

        return executor_map
