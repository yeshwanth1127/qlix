"""Local daemon CLI for hybrid agents: ``qlix daemon start|status|install``."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def _agent_file() -> Path:
    from .identity import resolve_agent_json_path

    try:
        return resolve_agent_json_path(None)
    except Exception:
        print(
            "Unzip your Qlix starter pack and double-click Start Qlix Agent, "
            "or set QLIX_AGENT_FILE to agent.json.",
            file=sys.stderr,
        )
        sys.exit(1)


def cmd_start(_args: argparse.Namespace) -> None:
    agent = _agent_file()
    if not agent.exists():
        print(f"agent.json not found: {agent}", file=sys.stderr)
        sys.exit(1)
    env = os.environ.copy()
    env.setdefault("QLIX_AGENT_FILE", str(agent))
    print(f"Starting hybrid runner (agent={agent.name})…", file=sys.stderr)
    from .hybrid_runner import main as hybrid_main

    hybrid_main()


def cmd_status(_args: argparse.Namespace) -> None:
    import json

    from .identity import load_identity
    from .http_client import QlixHttpClient

    identity = load_identity(_agent_file())
    token = os.environ.get("QLIX_RUNNER_TOKEN", "").strip()
    if not token:
        raw = identity.raw
        token = str(raw.get("runner_token") or raw.get("runnerToken") or "").strip()
    if not token:
        print("No runner token (QLIX_RUNNER_TOKEN or agent.json runner_token).", file=sys.stderr)
        sys.exit(1)

    async def _check() -> None:
        async with QlixHttpClient(base_url=identity.backend_url) as http:
            data = await http.get_json(
                f"/api/v1/agents/{identity.agent_id}/runtime-status",
                headers={"X-QLIX-Runner-Token": token},
            )
            print(json.dumps(data, indent=2))

    import asyncio

    asyncio.run(_check())


def cmd_install(args: argparse.Namespace) -> None:
    """Print a suggested systemd/launchd command (no OS service write in v1)."""
    agent = _agent_file()
    python = sys.executable
    cmd = (
        f'{python} -m qlix.hybrid_runner'
        if args.module == "hybrid_runner"
        else f'{python} -m qlix.daemon_cli start'
    )
    print("Add a user service that runs:")
    print(f"  QLIX_AGENT_FILE={agent}")
    print(f"  QLIX_RUNNER_TOKEN=<from agent creation>")
    print(f"  {cmd}")
    print("\nOr: pip install qlix && qlix daemon start")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="qlix", description="Qlix hybrid local daemon")
    sub = p.add_subparsers(dest="command", required=True)  # type: ignore[arg-type]
    start_p = sub.add_parser("start", help="Run hybrid poll loop in foreground")
    start_p.set_defaults(func=cmd_start)
    status_p = sub.add_parser("status", help="Query agent runtime status from backend")
    status_p.set_defaults(func=cmd_status)
    install_p = sub.add_parser("install", help="Print install instructions for a background service")
    install_p.add_argument(
        "--module",
        choices=("hybrid_runner", "daemon_cli"),
        default="hybrid_runner",
    )
    install_p.set_defaults(func=cmd_install)
    return p


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    if argv is None:
        argv = sys.argv[1:]
    if len(argv) >= 2 and argv[0] == "daemon":
        argv = argv[1:]
    ns = parser.parse_args(argv)
    ns.func(ns)


if __name__ == "__main__":
    main()
