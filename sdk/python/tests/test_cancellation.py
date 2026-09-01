from __future__ import annotations

import asyncio
import sys

import pytest

from qlix.cancellation import (
    CancellationToken,
    await_with_cancellation,
    cancellation_scope,
)
from qlix.luna.security.subprocess_sandbox import run_sandboxed
from qlix.subagents import SubAgentRunContext, _LiveInvocation


class _FakeHttp:
    async def post_json(self, *_args, **_kwargs):
        return {}


@pytest.mark.asyncio
async def test_active_work_is_interrupted_and_cleanup_runs_once() -> None:
    token = CancellationToken()
    cleaned: list[str] = []
    token.register_cleanup(lambda: cleaned.append("closed"))
    checks = 0

    async def work() -> None:
        await asyncio.sleep(30)

    async def check() -> None:
        nonlocal checks
        checks += 1
        if checks == 1:
            raise RuntimeError("stopped by user")

    with pytest.raises(RuntimeError, match="stopped by user"):
        await await_with_cancellation(work(), token=token, check=check, poll_interval=0.01)

    assert token.canceled is True
    assert cleaned == ["closed"]
    assert token.cancel("again") is False
    assert cleaned == ["closed"]


@pytest.mark.asyncio
async def test_cancel_kills_sandboxed_process_tree() -> None:
    token = CancellationToken()
    command = f'{sys.executable} -c "import time; time.sleep(30)"'

    async def run_process():
        with cancellation_scope(token):
            return await asyncio.to_thread(run_sandboxed, command, timeout=30)

    task = asyncio.create_task(run_process())
    await asyncio.sleep(0.15)
    token.cancel("test stop")
    result = await asyncio.wait_for(task, timeout=5)

    assert result.killed is True
    assert result.returncode != 0


@pytest.mark.asyncio
async def test_parent_cancellation_stops_all_live_subagents() -> None:
    async def child() -> dict[str, str]:
        await asyncio.sleep(30)
        return {"status": "completed"}

    tasks = [asyncio.create_task(child()) for _ in range(2)]
    ctx = object.__new__(SubAgentRunContext)
    ctx.live = {
        str(i): _LiveInvocation(invocation_id=str(i), task=task)
        for i, task in enumerate(tasks)
    }

    ctx.cancel_local("parent stopped")
    await asyncio.sleep(0)

    assert all(task.cancelled() for task in tasks)
    assert all(item.status == "canceled" for item in ctx.live.values())


@pytest.mark.asyncio
async def test_active_model_request_is_canceled_and_browser_is_closed(monkeypatch) -> None:
    from qlix import runner_common
    from qlix.luna.browser import factory

    class _Driver:
        closed = False

        def close(self) -> None:
            self.closed = True

    driver = _Driver()
    factory.set_browser_driver(driver)

    async def slow_model(*_args, **_kwargs):
        await asyncio.sleep(30)

    checks = 0

    async def stopped(*_args, **_kwargs):
        nonlocal checks
        checks += 1
        if checks > 1:
            raise runner_common.RunCanceledError("stopped")
        return []

    monkeypatch.setattr(runner_common, "backend_proxy_chat_completion", slow_model)
    monkeypatch.setattr(runner_common, "assert_run_not_canceled", stopped)

    with pytest.raises(runner_common.RunCanceledError, match="stopped"):
        await runner_common.run_backend_proxy_inference(
            _FakeHttp(),
            identity=object(),
            agent_id="agent-1",
            headers={},
            seq=0,
            run_id="run-1",
            model="test/model",
            enriched_prompt="do some work",
            tools=[],
            tool_executors={},
            tools_hash="none",
            tools_schema_bytes=0,
            log=lambda *_args, **_kwargs: None,
            max_rounds=1,
            max_seconds=10,
        )

    assert driver.closed is True


@pytest.mark.asyncio
async def test_active_async_tool_is_canceled(monkeypatch) -> None:
    from qlix import runner_common

    started = asyncio.Event()
    stopped = asyncio.Event()

    async def tool(_args: str) -> str:
        started.set()
        try:
            await asyncio.sleep(30)
        finally:
            stopped.set()
        return "never"

    async def check() -> None:
        await started.wait()
        raise runner_common.RunCanceledError("stopped during tool")

    with pytest.raises(runner_common.RunCanceledError, match="stopped during tool"):
        await runner_common.execute_runner_tool(
            http=_FakeHttp(),
            agent_id="agent-1",
            run_id="run-1",
            headers={},
            seq=0,
            name="slow_tool",
            args="{}",
            tool_executors={"slow_tool": tool},
            cancellation_token=CancellationToken(),
            cancellation_check=check,
        )

    assert stopped.is_set()
