from __future__ import annotations

import importlib.util
import json
import os
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any


@dataclass(frozen=True)
class LoadedCloudAdk:
    manifest: dict[str, Any]
    agent_class: type[Any]


def _load_module_from_file(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location("qlix_cloud_agent_module", str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _fallback_loaded_cloud_adk() -> LoadedCloudAdk:
    import qlix

    @qlix.agent(
        name="cloud-fallback-agent",
        description="Fallback cloud agent when ADK artifact is missing",
        system_prompt=(
            "You are a helpful cloud assistant. Solve the user's task directly, "
            "use available tools when needed, and return concise results."
        ),
        model="",
    )
    class CloudFallbackAgent:
        pass

    manifest: dict[str, Any] = {
        "manifestVersion": "fallback-v1",
        "name": "cloud-fallback-agent",
        "source": "auto_fallback_missing_adk",
    }
    return LoadedCloudAdk(manifest=manifest, agent_class=CloudFallbackAgent)


def load_cloud_adk() -> LoadedCloudAdk:
    manifest_path = Path(os.environ.get("QLIX_ADK_MANIFEST", "/run/adk/manifest.json")).resolve()
    module_path = Path(os.environ.get("QLIX_ADK_MODULE", "/run/adk/adk_agent.py")).resolve()
    class_name = os.environ.get("QLIX_ADK_CLASS", "CloudDeployedAgent").strip() or "CloudDeployedAgent"

    if not manifest_path.exists() or not module_path.exists():
        return _fallback_loaded_cloud_adk()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    module = _load_module_from_file(module_path)
    agent_class = getattr(module, class_name, None)
    if agent_class is None:
        raise RuntimeError(f"Cloud ADK class '{class_name}' not found in {module_path}")
    return LoadedCloudAdk(manifest=manifest, agent_class=agent_class)

