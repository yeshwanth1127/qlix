from __future__ import annotations

from qlix.cloud_route import route_mode


def test_route_mode_prefers_orchestrator_for_task_like_prompt() -> None:
    assert route_mode("Please analyze this repo and then create a summary", []) == "orchestrator"


def test_route_mode_prefers_orchestrator_when_skills_selected() -> None:
    assert route_mode("hi", ["web.search"]) == "orchestrator"


def test_route_mode_direct_for_small_chat() -> None:
    assert route_mode("hello", []) == "direct"

