from __future__ import annotations

import json
from pathlib import Path

from qlix.cloud_adk_loader import load_cloud_adk


def test_load_cloud_adk_from_env_paths(tmp_path: Path, monkeypatch) -> None:
    manifest_path = tmp_path / "manifest.json"
    module_path = tmp_path / "adk_agent.py"
    manifest_path.write_text(
        json.dumps({"manifestVersion": "1", "name": "test-adk", "model": "cloud"}, indent=2),
        encoding="utf-8",
    )
    module_path.write_text(
        "\n".join(
            [
                "class CloudDeployedAgent:",
                "    pass",
                "",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("QLIX_ADK_MANIFEST", str(manifest_path))
    monkeypatch.setenv("QLIX_ADK_MODULE", str(module_path))
    monkeypatch.setenv("QLIX_ADK_CLASS", "CloudDeployedAgent")

    loaded = load_cloud_adk()
    assert loaded.manifest["name"] == "test-adk"
    assert loaded.agent_class.__name__ == "CloudDeployedAgent"


def test_load_cloud_adk_fallback_when_files_missing(tmp_path: Path, monkeypatch) -> None:
    manifest_path = tmp_path / "missing-manifest.json"
    module_path = tmp_path / "missing-adk.py"
    monkeypatch.setenv("QLIX_ADK_MANIFEST", str(manifest_path))
    monkeypatch.setenv("QLIX_ADK_MODULE", str(module_path))
    monkeypatch.setenv("QLIX_ADK_CLASS", "CloudDeployedAgent")

    loaded = load_cloud_adk()
    assert loaded.manifest["source"] == "auto_fallback_missing_adk"
    assert loaded.agent_class.__name__ == "CloudFallbackAgent"

