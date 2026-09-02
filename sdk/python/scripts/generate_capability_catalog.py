"""Generate the authoritative managed-runtime capability catalog.

The catalog is built from the exact OpenAI schemas already exposed by Qlix.
Generation disables model-facing tool budgeting and captures both collapsed and
expanded browser modes; it does not alter runtime defaults.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Iterable


SDK_ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = SDK_ROOT / "capability_inventory.json"
DEFAULT_OUTPUT = SDK_ROOT / "qlix/data/capability_catalog.json"


def _identity(scopes: Iterable[str]):
    from qlix.identity import AgentIdentity

    return AgentIdentity(
        did="did:qlix:capability-catalog",
        agent_id="capability_catalog",
        private_key_hex="00" * 32,
        public_key_hex="11" * 32,
        permission_scopes=tuple(scopes),
        jit_scopes=tuple(scopes),
        always_scopes=(),
        backend_url="http://localhost:8080",
        llm_mode="proxy",
        raw={},
    )


def _tool_surfaces(
    inventory: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
    # Expose the complete supported surface only for catalog generation.
    os.environ["QLIX_DROP_NOOP_TOOLS"] = "0"
    os.environ["QLIX_ENABLE_DELEGATION"] = "1"
    os.environ["QLIX_ENABLE_SUBAGENTS"] = "0"

    from qlix.tool_router import ToolRouter, ToolRouterResult

    identity = _identity(inventory["backend"]["permissionScopes"])
    definitions: dict[str, dict[str, Any]] = {}
    arrays: dict[str, list[str]] = {}
    for runtime in ("cloud", "hybrid"):
        groups = tuple(
            group
            for group, runtimes in inventory["managedRuntime"]["groupRuntimes"].items()
            if runtime in runtimes
        )
        plan = ToolRouterResult(
            groups=groups,
            instruction="",
            skill_filter=None,
            guidance="",
            scope_groups=groups,
            read_only_intent=False,
        )
        collapse_modes = ("0", "1") if runtime == "cloud" else ("1",)
        for collapse in collapse_modes:
            os.environ["QLIX_BROWSER_COLLAPSE"] = collapse
            tools = ToolRouter(identity, runner_runtime=runtime).build_tool_definitions(
                plan,
                tool_profile="full",
            )
            array_name = (
                "cloudCollapsed"
                if runtime == "cloud" and collapse == "1"
                else "cloudExpanded"
                if runtime == "cloud"
                else "hybrid"
            )
            arrays[array_name] = [
                str((tool.get("function") or {}).get("name") or "")
                for tool in tools
                if isinstance(tool, dict)
            ]
            for tool in tools:
                function = tool.get("function") if isinstance(tool, dict) else None
                if not isinstance(function, dict):
                    continue
                name = function.get("name")
                if not isinstance(name, str) or not name:
                    continue
                normalized = {
                    "description": str(function.get("description") or ""),
                    "inputSchema": function.get("parameters")
                    if isinstance(function.get("parameters"), dict)
                    else {"type": "object"},
                }
                prior = definitions.get(name)
                if prior is not None and prior != normalized:
                    raise RuntimeError(f"Conflicting public schemas for capability {name}")
                definitions[name] = normalized
    return definitions, arrays


def _scope_metadata() -> tuple[dict[str, tuple[str, ...]], set[str]]:
    from qlix.agents3_runtime import TOOL_ANY_OF_SCOPES, TOOL_SCOPE_MAP
    from qlix.assessment_runtime import ASSESSMENT_TOOL_SCOPES
    from qlix.cloud_brain_file_runtime import BRAIN_FILE_TOOL_SCOPES
    from qlix.cloud_crm_runtime import CRM_TOOL_SCOPES
    from qlix.cloud_document_runtime import DOCUMENT_TOOL_SCOPES
    from qlix.cloud_email_runtime import EMAIL_TOOL_SCOPES
    from qlix.cloud_google_workspace_runtime import GOOGLE_TOOL_SCOPES
    from qlix.cloud_notion_runtime import NOTION_TOOL_SCOPES
    from qlix.cloud_research_runtime import RESEARCH_TOOL_SCOPES
    from qlix.cloud_slack_runtime import SLACK_TOOL_SCOPES
    from qlix.cloud_whatsapp_runtime import WHATSAPP_TOOL_SCOPES
    from qlix.cloud_conversation_runtime import CONVERSATION_TOOL_SCOPES
    from qlix.luna.browser.agent_browser_cli import AGENT_BROWSER_TOOL_SCOPES

    scopes: dict[str, tuple[str, ...]] = {}
    for mapping in (
        TOOL_SCOPE_MAP,
        ASSESSMENT_TOOL_SCOPES,
        BRAIN_FILE_TOOL_SCOPES,
        CRM_TOOL_SCOPES,
        DOCUMENT_TOOL_SCOPES,
        EMAIL_TOOL_SCOPES,
        GOOGLE_TOOL_SCOPES,
        NOTION_TOOL_SCOPES,
        RESEARCH_TOOL_SCOPES,
        SLACK_TOOL_SCOPES,
        WHATSAPP_TOOL_SCOPES,
        CONVERSATION_TOOL_SCOPES,
        AGENT_BROWSER_TOOL_SCOPES,
    ):
        scopes.update({name: tuple(values) for name, values in mapping.items()})
    scopes["brain_query"] = ("brain.query",)
    browser_scopes = sorted({scope for values in AGENT_BROWSER_TOOL_SCOPES.values() for scope in values})
    scopes["browser"] = tuple(browser_scopes)
    for name in ("think", "done", "find_tools", "call_tool", "delegate_task"):
        scopes[name] = ()
    return scopes, {*TOOL_ANY_OF_SCOPES, "browser"}


def _provider(name: str, groups: list[str]) -> tuple[str, str]:
    if name.startswith("browser"):
        return "browser", "agent_browser"
    if name.startswith("luna_local_") or name == "gui_control":
        return "local", "agents3"
    if name.startswith("conversation_"):
        return "backend_proxy", "qlix.conversation"
    if "assessment" in groups:
        return "backend_proxy", "qlix.assessment"
    if "knowledge" in groups:
        return "backend_proxy", "qlix.brain"
    if name.startswith("research_"):
        return "backend_proxy", "legacy.research_router"
    if name in {"create_report_pdf", "create_xlsx"}:
        return "builtin", "document_renderer"
    if "comms" in groups:
        if name.startswith(("drive_", "docs_", "sheets_", "slides_", "forms_", "calendar_", "meet_")):
            provider = "google_workspace"
        else:
            provider = name.split("_", 1)[0]
        return "connector", provider
    return "builtin", "runner"


def _risk(name: str, scopes: tuple[str, ...]) -> tuple[str, list[str]]:
    effects: set[str] = set()
    lowered = set(scopes)
    if any(scope.endswith((".read", ".query", ".search", ".get")) for scope in lowered) or "web.research" in lowered:
        effects.add("read")
    if any(
        scope.endswith((".write", ".delete", ".record", ".create", ".publish", ".manage", ".auto_reply"))
        for scope in lowered
    ):
        effects.add("write")
    if any(scope.endswith(".send") or scope == "whatsapp.contact_send" for scope in lowered):
        effects.add("external_communication")
    if "conversation" in lowered:
        if name in {"conversation_list", "conversation_get"}:
            effects.add("read")
        else:
            effects.add("write")
            if name in {"conversation_start", "conversation_send"}:
                effects.add("external_communication")
    if any(scope.startswith("finance.") for scope in lowered):
        effects.add("financial")
    if name in {"luna_local_bash", "luna_local_python", "luna_local_code_task", "gui_control"} or (
        name.startswith("browser") and any(scope in lowered for scope in ("web.click", "web.transaction"))
    ):
        effects.add("execute")
    if "financial" in effects:
        level = "critical"
    elif "external_communication" in effects:
        level = "high"
    elif effects.intersection({"write", "execute"}):
        level = "moderate"
    else:
        level = "low"
    return level, sorted(effects)


def build_catalog() -> dict[str, Any]:
    from qlix.contracts import CapabilityDescriptor, CapabilityJit, CapabilityProvider, CapabilityRisk

    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    definitions, tool_arrays = _tool_surfaces(inventory)
    scopes, any_scope = _scope_metadata()
    metadata = inventory["managedRuntime"]["toolCapabilities"]
    expected = set(metadata)
    if set(definitions) != expected:
        raise RuntimeError(
            f"Catalog/schema mismatch; missing={sorted(expected - set(definitions))}, "
            f"extra={sorted(set(definitions) - expected)}"
        )

    capabilities: dict[str, Any] = {}
    for name in sorted(expected):
        meta = metadata[name]
        required_scopes = scopes.get(name)
        if required_scopes is None:
            raise RuntimeError(f"No authoritative scope mapping for capability {name}")
        provider_kind, provider_id = _provider(name, meta["groups"])
        risk_level, risk_effects = _risk(name, required_scopes)
        descriptor = CapabilityDescriptor(
            name=name,
            description=definitions[name]["description"],
            input_schema=definitions[name]["inputSchema"],
            required_scopes=required_scopes,
            scope_mode="any" if name in any_scope else "all",
            jit=CapabilityJit(required=False, scopes=required_scopes),
            runtimes=tuple(meta["runtimes"]),
            risk=CapabilityRisk(level=risk_level, effects=tuple(risk_effects)),
            provider=CapabilityProvider(kind=provider_kind, id=provider_id),
        )
        capabilities[name] = descriptor.to_wire()
    return {
        "formatVersion": 1,
        "semantics": "maximum supported managed-runtime surface; runtime selection, scopes, JIT policy, tool profile, configuration, credentials, and dependencies still gate availability",
        "capabilities": capabilities,
        "toolArrays": tool_arrays,
    }


def render_catalog() -> str:
    return json.dumps(build_catalog(), indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    rendered = render_catalog()
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != rendered:
            print(f"Capability catalog is stale: {args.output}")
            return 1
        print(f"Capability catalog is current: {args.output}")
        return 0
    args.output.write_text(rendered, encoding="utf-8")
    print(f"Wrote capability catalog: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
