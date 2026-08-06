"""Build the end-user hybrid starter ZIP (agent.json + OS launcher + optional wheel)."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any, Literal

_STARTER_DIR = Path(__file__).resolve().parent / "starter_pack"

HybridPlatform = Literal["windows", "macos", "linux"]

_LAUNCHER_BY_PLATFORM: dict[HybridPlatform, str] = {
    "windows": "Start Qlix Agent.bat",
    "macos": "Start Qlix Agent.command",
    "linux": "Start Qlix Agent.sh",
}

_WHEEL_CANDIDATES = (
    Path(__file__).resolve().parents[3]
    / "backend"
    / "assets"
    / "hybrid-starter"
    / "qlix-0.1.0-py3-none-any.whl",
    Path(__file__).resolve().parents[3] / "backend" / "assets" / "hybrid-starter" / "qlix-agent.whl",
    Path(__file__).resolve().parents[1] / "dist" / "qlix-0.1.0-py3-none-any.whl",
    Path(__file__).resolve().parents[1] / "dist" / "qlix-agent.whl",
)


def _safe_zip_name(agent_name: str, platform: HybridPlatform) -> str:
    cleaned = "".join(c if c.isalnum() or c in "._- " else "-" for c in agent_name.strip())
    cleaned = cleaned.strip(" .-") or "qlix-agent"
    return f"{cleaned[:64]}-starter-pack-{platform}.zip"


def _find_wheel() -> Path | None:
    env = __import__("os").environ.get("QLIX_HYBRID_WHEEL", "").strip()
    if env:
        p = Path(env)
        if p.is_file():
            return p
    for candidate in _WHEEL_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def build_hybrid_starter_zip(
    agent_json: dict[str, Any],
    *,
    agent_name: str = "agent",
    platform: HybridPlatform = "windows",
) -> tuple[bytes, str]:
    """Return (zip_bytes, suggested_filename)."""
    launcher = _LAUNCHER_BY_PLATFORM[platform]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "agent.json",
            json.dumps(agent_json, indent=2, ensure_ascii=False) + "\n",
        )
        readme = _STARTER_DIR / "README.txt"
        if readme.is_file():
            zf.write(readme, arcname="README.txt")
        launcher_path = _STARTER_DIR / launcher
        if launcher_path.is_file():
            zf.write(launcher_path, arcname=launcher)
        wheel = _find_wheel()
        if wheel:
            # PEP 427 name required — pip rejects aliases like "qlix-agent.whl".
            zf.write(wheel, arcname="qlix-0.1.0-py3-none-any.whl")
    return buf.getvalue(), _safe_zip_name(agent_name, platform)


def main() -> None:
    import argparse
    import sys

    p = argparse.ArgumentParser(description="Build hybrid starter ZIP from agent.json")
    p.add_argument("agent_json", type=Path, help="Path to hybrid agent.json")
    p.add_argument(
        "--platform",
        choices=("windows", "macos", "linux"),
        default="windows",
    )
    p.add_argument("-o", "--output", type=Path, help="Output .zip path")
    args = p.parse_args()
    data = json.loads(args.agent_json.read_text(encoding="utf-8"))
    name = str(data.get("agent_id") or data.get("name") or "agent")
    blob, fn = build_hybrid_starter_zip(
        data, agent_name=name, platform=args.platform
    )
    out = args.output or args.agent_json.with_name(fn)
    out.write_bytes(blob)
    print(f"Wrote {out} ({len(blob)} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
