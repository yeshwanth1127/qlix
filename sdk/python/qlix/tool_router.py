"""Intent-based tool group selection for cloud and hybrid runners."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from .agents3_runtime import is_read_only_file_intent
from .identity import AgentIdentity

ToolGroup = Literal["web", "files", "code", "gui", "comms", "knowledge", "always"]

GROUP_REQUIRED_SCOPES: dict[ToolGroup, tuple[str, ...]] = {
    "web": ("web.read", "web.click", "web.transaction"),
    "files": ("system.file_read", "system.file_write"),
    "code": ("system.file_read",),
    "gui": ("system.gui_control",),
    "comms": ("email.read", "email.send", "whatsapp.send"),
    "knowledge": ("brain.query", "brain.knowledge_read"),
    "always": (),
}

GROUP_RUNTIMES: dict[ToolGroup, frozenset[str]] = {
    "web": frozenset({"cloud"}),
    "files": frozenset({"hybrid"}),
    "code": frozenset({"hybrid"}),
    "gui": frozenset({"hybrid"}),
    "comms": frozenset({"cloud", "hybrid"}),
    "knowledge": frozenset({"cloud", "hybrid"}),
    "always": frozenset({"cloud", "hybrid"}),
}

KEYWORD_MAP: dict[ToolGroup, frozenset[str]] = {
    "web": frozenset(
        {
            "browse",
            "website",
            "url",
            "google",
            "search online",
            "search the web",
            "search for",
            "navigate to",
            "http",
            "https",
            "web page",
            "scrape",
            "internet",
            "research",
            "look up",
            "find out",
            "online",
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
            "slack",
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
            "whatsapp",
            "whats app",
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


@dataclass(frozen=True)
class ToolRouterResult:
    groups: tuple[ToolGroup, ...]
    instruction: str
    skill_filter: list[str] | None


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
            selected.add("always")
            return tuple(g for g in ("web", "files", "code", "gui", "comms", "knowledge", "always") if g in selected)

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

    if runner_runtime == "hybrid" and "comms" in selected:
        # Email-on-hybrid shouldn't drag the browser in, but WhatsApp file delivery
        # is commonly paired with a browser screenshot/PDF — keep web in that case.
        if not any(kw in text for kw in ("whatsapp", "whats app")):
            selected.discard("web")

    final: list[ToolGroup] = []
    for g in ("web", "files", "code", "gui", "comms", "knowledge", "always"):
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
        return ToolRouterResult(
            groups=groups,
            instruction=routing_text,
            skill_filter=skill_filter,
        )

    def build_tool_definitions(
        self,
        plan: ToolRouterResult,
    ) -> list[dict[str, Any]]:
        from .cloud_browser_runtime import openai_browser_tool_definitions
        from .cloud_email_runtime import openai_email_tool_definitions
        from .cloud_whatsapp_runtime import openai_whatsapp_tool_definitions
        from .agents3_runtime import openai_agents3_tool_definitions
        from .local_tool_definitions import (
            openai_always_tool_definitions,
            openai_knowledge_tool_definitions,
        )

        tools: list[dict[str, Any]] = []
        sf = plan.skill_filter if plan.skill_filter else None

        if "web" in plan.groups:
            tools.extend(openai_browser_tool_definitions(self.identity, sf))
        if self.runner_runtime == "hybrid" and any(
            g in plan.groups for g in ("files", "code", "gui")
        ):
            tools.extend(
                openai_agents3_tool_definitions(
                    self.identity,
                    groups=plan.groups,
                    skill_filter=sf,
                    instruction=plan.instruction,
                )
            )
        if "comms" in plan.groups:
            tools.extend(openai_email_tool_definitions(self.identity, sf))
            tools.extend(openai_whatsapp_tool_definitions(self.identity, sf))
        if "knowledge" in plan.groups:
            tools.extend(openai_knowledge_tool_definitions(self.identity, sf))
        if "always" in plan.groups:
            tools.extend(openai_always_tool_definitions())

        return tools

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
    ) -> dict[str, callable]:
        import json

        from .cloud_browser_runtime import (
            openai_browser_tool_definitions,
            resolve_tool_name,
            _use_agent_browser_suite,
            _remap_legacy_params,
            _effective_granted_scopes,
        )
        from .cloud_email_runtime import build_email_tool_executors
        from .cloud_whatsapp_runtime import build_whatsapp_tool_executors
        from .agents3_runtime import build_agents3_executors
        from .luna.core.registry import ToolRegistry

        executor_map: dict[str, callable] = {}
        sf = plan.skill_filter

        if "web" in plan.groups:
            tools_list = openai_browser_tool_definitions(self.identity, sf)
            for tool_def in tools_list:
                tool_name = tool_def["function"]["name"]
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
                    from .luna.browser.agent_browser_cli import run_agent_browser_tool

                    scopes = _effective_granted_scopes(self.identity)

                    def _make_ab(name, scps):
                        def _execute(args_json: str):
                            params = json.loads(args_json) if args_json.strip() else {}
                            if not isinstance(params, dict):
                                params = {}
                            ok, content = run_agent_browser_tool(name, params, granted_scopes=scps)
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
            g in plan.groups for g in ("files", "code", "gui")
        ):
            executor_map.update(
                build_agents3_executors(
                    self.identity,
                    groups=plan.groups,
                    qlix_sdk=qlix_sdk,
                    skill_filter=sf,
                    agents3_context=agents3_context,
                    instruction=plan.instruction,
                )
            )

        if "comms" in plan.groups and agent_id and run_id and backend_url and runner_token:
            email_executors = build_email_tool_executors(
                identity=self.identity,
                skill_filter=sf,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
            )
            executor_map.update(email_executors)
            whatsapp_executors = build_whatsapp_tool_executors(
                identity=self.identity,
                skill_filter=sf,
                agent_id=agent_id,
                run_id=run_id,
                backend_url=backend_url,
                runner_token=runner_token,
            )
            executor_map.update(whatsapp_executors)

        if "knowledge" in plan.groups:
            def _brain_stub(_args: str) -> str:
                return "Company brain context is prepended to the user message for this run."

            executor_map.setdefault("brain_query", _brain_stub)

        if "always" in plan.groups:
            def _think(args_json: str) -> str:
                return "Thought recorded."

            def _done(args_json: str) -> str:
                return "Task marked complete."

            executor_map.setdefault("think", _think)
            executor_map.setdefault("done", _done)

        return executor_map
