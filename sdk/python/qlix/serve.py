"""qlix.serve — HTTP server for @qlix.agent classes.

Wraps an AgentRunner in a FastAPI application and serves it on a given host
and port. Designed for future-proof API shape: POST /run is synchronous for
v1 but the polling endpoint (GET /run/{task_id}) is already in place so
clients never need to change their API contract when async execution is added.

Requires fastapi and uvicorn:
    pip install fastapi uvicorn

Usage::

    import qlix

    qlix.serve(MyAgent, host="0.0.0.0", port=8000)

Endpoints
---------
POST /run
    Body:  { "message": "..." }
    Returns a RunResult immediately (synchronous for v1).
    Also stores the result under result.task_id for polling.

GET /run/{task_id}
    Returns { "status": "completed", "result": RunResult }
    or      { "status": "not_found", "task_id": "..." }

    For v1 the result is always immediately available. This endpoint exists
    so clients poll for results from day one — no API contract change needed
    when long-running async execution is added later.

GET /health
    Returns { "status": "ok", "agent": "<name>" }
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Type


def serve(
    agent_class: Type[Any],
    *,
    host: str = "0.0.0.0",
    port: int = 8000,
    sdk: Any = None,
) -> None:
    """Start a blocking HTTP server for the given @qlix.agent class.

    Parameters
    ----------
    agent_class:
        A class decorated with @qlix.agent.
    host:
        Interface to bind to. Defaults to all interfaces.
    port:
        Port to listen on. Defaults to 8000.
    sdk:
        Optional QlixSDK instance. Falls back to the active global SDK.
    """
    try:
        from fastapi import FastAPI
        from pydantic import BaseModel
        import uvicorn
    except ImportError as exc:
        raise ImportError(
            "qlix.serve requires fastapi and uvicorn. "
            "Install with: pip install fastapi uvicorn"
        ) from exc

    from .runner import AgentRunner

    if not hasattr(agent_class, "_qlix_agent"):
        raise TypeError(
            f"{agent_class!r} is not decorated with @qlix.agent."
        )

    meta = agent_class._qlix_agent
    app = FastAPI(title=meta.name, description=meta.description or "")
    _runner = AgentRunner(agent_class, sdk=sdk)

    # In-memory result store: task_id → serialised RunResult dict.
    # Replace with a persistent store (Redis, DB) when horizontal scaling
    # or result durability is needed.
    _results: dict[str, dict[str, Any]] = {}

    class RunRequest(BaseModel):
        message: str

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @app.on_event("startup")
    async def _startup() -> None:
        await _runner.boot()

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await _runner.close()

    # ------------------------------------------------------------------
    # Endpoints
    # ------------------------------------------------------------------

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "agent": meta.name}

    @app.post("/run")
    async def run(req: RunRequest) -> dict[str, Any]:
        result = await _runner.run(req.message)
        result_dict = asdict(result)
        _results[result.task_id] = result_dict
        return result_dict

    @app.get("/run/{task_id}")
    async def get_result(task_id: str) -> dict[str, Any]:
        stored = _results.get(task_id)
        if stored is None:
            return {"status": "not_found", "task_id": task_id}
        return {"status": "completed", "result": stored}

    # ------------------------------------------------------------------
    # Start
    # ------------------------------------------------------------------

    uvicorn.run(app, host=host, port=port)


__all__ = ["serve"]
