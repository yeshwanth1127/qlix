"""Generate a deterministic inventory of Qlix's public agent capabilities.

The generator intentionally uses only the Python standard library and static
source inspection. Importing Luna registers optional providers and can require
credentials or platform-specific dependencies, which would make the baseline
vary by machine.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
from pathlib import Path
from typing import Any, Iterable


SDK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SDK_ROOT.parents[1]
DEFAULT_OUTPUT = SDK_ROOT / "capability_inventory.json"


def _sorted_unique(values: Iterable[str]) -> list[str]:
    return sorted({value for value in values if value})


def _python_files(root: Path) -> Iterable[Path]:
    return sorted(
        path
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def _literal_string(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _decorator_registrations(root: Path) -> dict[str, list[str]]:
    registrations: dict[str, set[str]] = {}
    for path in _python_files(root):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            raise RuntimeError(f"Cannot inventory invalid Python source: {path}") from exc
        for node in ast.walk(tree):
            if not isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not decorator.args:
                    continue
                function = decorator.func
                if not (
                    isinstance(function, ast.Attribute)
                    and function.attr == "register"
                    and isinstance(function.value, ast.Name)
                ):
                    continue
                key = _literal_string(decorator.args[0])
                if key is not None:
                    registrations.setdefault(function.value.id, set()).add(key)
    return {
        registry: sorted(keys)
        for registry, keys in sorted(registrations.items())
    }


def _module_exports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == "__all__" for target in targets):
            continue
        value = node.value
        if isinstance(value, (ast.List, ast.Tuple)):
            return _sorted_unique(
                item
                for element in value.elts
                if (item := _literal_string(element)) is not None
            )
    return []


def _typescript_scope_ids() -> list[str]:
    types_path = REPO_ROOT / "backend/src/agents/agents.types.ts"
    catalog_path = REPO_ROOT / "backend/src/agents/scopeCatalog.ts"
    values: list[str] = []
    for path in (types_path, catalog_path):
        text = path.read_text(encoding="utf-8")
        values.extend(re.findall(r"(?:^\s*\||\bid:)\s*['\"]([a-z][a-z0-9_.\-*]+)['\"]", text, re.MULTILINE))
    return _sorted_unique(values)


def _unmapped_permission_scopes(scopes: Iterable[str]) -> list[str]:
    declaration_files = {
        REPO_ROOT / "backend/src/agents/agents.types.ts",
        REPO_ROOT / "backend/src/agents/scopeCatalog.ts",
    }
    implementation_text: list[str] = []
    for root in (REPO_ROOT / "backend/src", SDK_ROOT / "qlix"):
        for path in sorted(root.rglob("*")):
            if (
                path in declaration_files
                or not path.is_file()
                or path.suffix not in {".py", ".ts"}
                or path.name.endswith((".test.ts", "_test.py"))
            ):
                continue
            implementation_text.append(path.read_text(encoding="utf-8"))
    joined = "\n".join(implementation_text)
    return _sorted_unique(scope for scope in scopes if scope not in joined)


def _mapping_keys(path: Path, assignment_name: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == assignment_name for target in targets):
            continue
        if isinstance(node.value, ast.Dict):
            return _sorted_unique(
                key
                for raw_key in node.value.keys
                if raw_key is not None and (key := _literal_string(raw_key)) is not None
            )
    return []


def _sequence_strings(path: Path, assignment_name: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == assignment_name for target in targets):
            continue
        if isinstance(node.value, (ast.List, ast.Tuple, ast.Set)):
            return _sorted_unique(
                item
                for element in node.value.elts
                if (item := _literal_string(element)) is not None
            )
    return []


def _mapping_string_values(path: Path, assignment_name: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == assignment_name for target in targets):
            continue
        if isinstance(node.value, ast.Dict):
            return _sorted_unique(
                item
                for value in node.value.values
                if (item := _literal_string(value)) is not None
            )
    return []


def _group_runtimes(path: Path) -> dict[str, list[str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue
        if node.target.id != "GROUP_RUNTIMES" or not isinstance(node.value, ast.Dict):
            continue
        result: dict[str, list[str]] = {}
        for raw_key, raw_value in zip(node.value.keys, node.value.values):
            key = _literal_string(raw_key) if raw_key is not None else None
            if not key or not isinstance(raw_value, ast.Call) or not raw_value.args:
                continue
            values = raw_value.args[0]
            if isinstance(values, (ast.Set, ast.List, ast.Tuple)):
                result[key] = _sorted_unique(
                    item
                    for element in values.elts
                    if (item := _literal_string(element)) is not None
                )
        return dict(sorted(result.items()))
    return {}


def _managed_runtime_inventory() -> dict[str, Any]:
    qlix_root = SDK_ROOT / "qlix"
    group_tools = {
        "research": _mapping_keys(qlix_root / "cloud_research_runtime.py", "RESEARCH_TOOL_DEFINITIONS")
        + _mapping_keys(qlix_root / "cloud_document_runtime.py", "DOCUMENT_TOOL_DEFINITIONS"),
        # Preserve both public modes: the collapsed `browser` facade and every
        # expanded agent-browser tool. `browser_exec` is intentionally not in
        # _BROWSER_ACTION_MAP because it is an expert escape hatch, so include it.
        "web": ["browser", "browser_exec"] + _mapping_string_values(
            qlix_root / "cloud_browser_runtime.py", "_BROWSER_ACTION_MAP"
        ),
        "files": _sequence_strings(qlix_root / "agents3_runtime.py", "LOCAL_TOOL_IDS"),
        "code": _sequence_strings(qlix_root / "agents3_runtime.py", "CODE_TOOL_IDS"),
        "gui": _sequence_strings(qlix_root / "agents3_runtime.py", "GUI_TOOL_IDS"),
        "comms": (
            _mapping_keys(qlix_root / "cloud_email_runtime.py", "EMAIL_TOOL_DEFINITIONS")
            + _mapping_keys(qlix_root / "cloud_google_workspace_runtime.py", "GOOGLE_TOOL_DEFINITIONS")
            + _mapping_keys(qlix_root / "cloud_crm_runtime.py", "CRM_TOOL_DEFINITIONS")
            + _mapping_keys(qlix_root / "cloud_slack_runtime.py", "SLACK_TOOL_DEFINITIONS")
            + _mapping_keys(qlix_root / "cloud_notion_runtime.py", "NOTION_TOOL_DEFINITIONS")
            + _mapping_keys(qlix_root / "cloud_whatsapp_runtime.py", "WHATSAPP_TOOL_DEFINITIONS")
        ),
        "knowledge": ["brain_query"]
        + _mapping_keys(qlix_root / "cloud_brain_file_runtime.py", "BRAIN_FILE_TOOL_DEFINITIONS"),
        "assessment": _mapping_keys(qlix_root / "assessment_runtime.py", "ASSESSMENT_TOOL_SCOPES"),
        "always": ["call_tool", "delegate_task", "done", "find_tools", "think"],
    }
    group_tools = {group: _sorted_unique(tools) for group, tools in sorted(group_tools.items())}
    group_runtimes = _group_runtimes(qlix_root / "tool_router.py")
    runtime_tools: dict[str, list[str]] = {}
    for runtime in ("cloud", "hybrid"):
        runtime_tools[runtime] = _sorted_unique(
            tool
            for group, runtimes in group_runtimes.items()
            if runtime in runtimes
            for tool in group_tools.get(group, [])
        )
    tool_capabilities: dict[str, dict[str, Any]] = {}
    for group, tools in group_tools.items():
        for tool in tools:
            descriptor = tool_capabilities.setdefault(
                tool,
                {"groups": [], "runtimes": [], "dynamic": False, "scopeGated": True},
            )
            descriptor["groups"] = _sorted_unique([*descriptor["groups"], group])
            descriptor["runtimes"] = _sorted_unique(
                [*descriptor["runtimes"], *group_runtimes.get(group, [])]
            )
    return {
        "availabilitySemantics": "maximum advertised surface; each tool remains scope, profile, config, dependency, and credential gated",
        "groupRuntimes": group_runtimes,
        "groupTools": group_tools,
        "runtimeTools": runtime_tools,
        "toolCapabilities": dict(sorted(tool_capabilities.items())),
    }


def _typescript_registered_values(path: Path, call_name: str, property_name: str) -> list[str]:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"{re.escape(call_name)}\s*\(\s*\{{.*?\b{re.escape(property_name)}\s*:\s*['\"]([^'\"]+)['\"]",
        re.DOTALL,
    )
    return _sorted_unique(pattern.findall(text))


def _typescript_property_values(root: Path, property_name: str) -> list[str]:
    values: list[str] = []
    for path in sorted(root.rglob("*.ts")):
        if path.name.endswith(".test.ts"):
            continue
        text = path.read_text(encoding="utf-8")
        values.extend(
            re.findall(
                rf"\b{re.escape(property_name)}\s*:\s*['\"]([a-z][a-z0-9_.-]+)['\"]",
                text,
            )
        )
    return _sorted_unique(values)


def _conversation_plugin_names(root: Path) -> list[str]:
    values: list[str] = []
    for path in sorted(root.rglob("*.ts")):
        if path.name.endswith(".test.ts"):
            continue
        text = path.read_text(encoding="utf-8")
        values.extend(re.findall(r"\bname\s*:\s*['\"]([a-z][a-z0-9_.-]+)['\"]", text))
    return _sorted_unique(value for value in values if "." in value)


def _built_in_skill_names(root: Path) -> list[str]:
    names: list[str] = []
    for path in sorted(root.glob("*.toml")):
        match = re.search(r"(?m)^name\s*=\s*['\"]([^'\"]+)['\"]", path.read_text(encoding="utf-8"))
        if match:
            names.append(match.group(1))
    return _sorted_unique(names)


def _agent_registry_aliases(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    pairs = re.findall(
        r'register_value\(\s*["\']([^"\']+)["\']\s*,\s*AgentRegistry\.get\(\s*["\']([^"\']+)["\']',
        text,
    )
    return dict(sorted(pairs))


def _dataclass_literal_defaults(path: Path) -> dict[str, dict[str, Any]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    defaults: dict[str, dict[str, Any]] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        is_dataclass = any(
            (isinstance(decorator, ast.Name) and decorator.id == "dataclass")
            or (
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Name)
                and decorator.func.id == "dataclass"
            )
            for decorator in node.decorator_list
        )
        if not is_dataclass:
            continue
        fields: dict[str, Any] = {}
        for child in node.body:
            if not isinstance(child, ast.AnnAssign) or not isinstance(child.target, ast.Name):
                continue
            try:
                value = ast.literal_eval(child.value)
            except (ValueError, TypeError):
                continue
            if value is None or isinstance(value, (str, int, float, bool, list, dict)):
                fields[child.target.id] = value
        if fields:
            defaults[node.name] = dict(sorted(fields.items()))
    return dict(sorted(defaults.items()))


def build_inventory() -> dict[str, Any]:
    luna_root = SDK_ROOT / "qlix/luna"
    assessment_runtime = SDK_ROOT / "qlix/assessment_runtime.py"
    registrations = _decorator_registrations(luna_root)
    permission_scopes = _typescript_scope_ids()
    managed_runtime = _managed_runtime_inventory()
    runner_tools = {
        tool
        for tools in managed_runtime["runtimeTools"].values()
        for tool in tools
    }
    described_tools = set(managed_runtime["toolCapabilities"])
    agent_aliases = _agent_registry_aliases(luna_root / "agents/__init__.py")
    agent_names = set(registrations.get("AgentRegistry", []))
    return {
        "formatVersion": 1,
        "compatibilityPolicy": {
            "additiveByDefault": True,
            "preserveExistingNames": True,
            "preserveExistingWireContracts": True,
        },
        "backend": {
            "permissionScopes": permission_scopes,
            "gatewayChannels": _typescript_property_values(
                REPO_ROOT / "backend/src/gateway/adapters",
                "channel",
            ),
            "conversationPlugins": _conversation_plugin_names(
                REPO_ROOT / "backend/src/assessment"
            ),
        },
        "luna": {
            "publicExports": _module_exports(luna_root / "__init__.py"),
            "registries": registrations,
            "skills": {
                "builtIn": _built_in_skill_names(luna_root / "skills/data"),
                "discoveryLayouts": ["SKILL.md", "skill.toml"],
                "externalSources": ["github", "hermes", "openclaw"],
            },
            "configDefaults": {
                "semantics": "literal dataclass defaults; computed default_factory values are intentionally excluded",
                "classes": _dataclass_literal_defaults(luna_root / "core/config.py"),
            },
            "compatibilityAliases": {
                "agents": agent_aliases,
                "discoveredToolPrefixes": {
                    prefix: ""
                    for prefix in _sequence_strings(
                        SDK_ROOT / "qlix/tool_router.py",
                        "_DISCOVERED_TOOL_PREFIXES",
                    )
                },
            },
        },
        "managedRuntime": managed_runtime,
        "mcp": {
            "dynamicTools": True,
            "toolNamePattern": "mcp__<server-slug>__<sanitized-tool-name>",
            "scopePatterns": ["mcp.<server-slug>.*", "mcp.<server-slug>.<tool-name>"],
            "transports": {
                "http": ["cloud", "hybrid"],
                "stdio": ["hybrid"],
            },
        },
        "consistency": {
            "unmappedPermissionScopes": _unmapped_permission_scopes(permission_scopes),
            "runnerToolsMissingCapabilityMetadata": sorted(runner_tools - described_tools),
            "brokenAgentCompatibilityAliases": sorted(
                alias for alias, target in agent_aliases.items() if target not in agent_names
            ),
        },
        "lunaTeams": {
            "publicExports": _module_exports(SDK_ROOT / "qlix/luna_teams/__init__.py"),
            "commanderTools": [
                "dispatch_to",
                "interrupt_member",
                "request_wait",
                "wait_result",
            ],
            "provenanceFields": [
                "artifactRefs",
                "evidenceRefs",
                "inputRefs",
                "knowledgeRefs",
                "recordRefs",
                "toolRefs",
            ],
        },
    }


def render_inventory() -> str:
    return json.dumps(build_inventory(), indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Fail when the checked-in inventory is stale")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    rendered = render_inventory()
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != rendered:
            print(f"Capability inventory is stale: {args.output}")
            return 1
        print(f"Capability inventory is current: {args.output}")
        return 0
    args.output.write_text(rendered, encoding="utf-8")
    print(f"Wrote capability inventory: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
