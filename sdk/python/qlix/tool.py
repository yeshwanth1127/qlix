"""@qlix.tool — ADK decorator for defining audited, scoped, billed tools."""

from __future__ import annotations

import functools
import inspect
from dataclasses import dataclass
from typing import Any, Callable

from .dev import is_dev_mode

RiskLevel = str  # "low" | "medium" | "high"

_PY_TO_JSON: dict[type, str] = {
    int: "integer",
    float: "number",
    str: "string",
    bool: "boolean",
    list: "array",
    dict: "object",
}


@dataclass(frozen=True)
class ToolMeta:
    """Metadata attached to every @qlix.tool-decorated function.

    Used by @qlix.agent in step 2 to serialize the agent manifest.
    """

    scope: str
    risk_level: RiskLevel
    description: str
    parameters: dict[str, Any]  # JSON Schema object for the function signature


def tool(
    scope: str,
    *,
    risk: RiskLevel = "low",
    description: str = "",
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator that turns an async function into a Qlix-audited tool.

    Usage::

        @qlix.tool(scope="web.read", risk="low", description="Fetch a web page")
        async def fetch_page(url: str) -> str:
            ...

    At call time the wrapper:
      1. In ``QLIX_DEV=1`` mode: skips all billing/signing and calls the
         function directly.
      2. Otherwise: requires an active ``QlixSDK``, checks scope, requests JIT
         approval if needed, posts ``/actions/start``, runs the function, posts
         ``/actions/complete``.

    The decorated function gains a ``._qlix_tool`` attribute (a
    :class:`ToolMeta`) that ``@qlix.agent`` reads in step 2 to build the agent
    manifest.
    """

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        if not inspect.iscoroutinefunction(fn):
            raise TypeError(
                f"@qlix.tool requires an async function. "
                f"Got {fn!r}. Add 'async' to your function definition."
            )

        sig = inspect.signature(fn)
        meta = ToolMeta(
            scope=scope,
            risk_level=risk,
            description=description or (fn.__doc__ or "").strip(),
            parameters=_sig_to_json_schema(sig),
        )

        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            if is_dev_mode():
                return await fn(*args, **kwargs)

            from .luna._gate import get_active_sdk

            sdk = get_active_sdk()
            if sdk is None:
                raise RuntimeError(
                    "No active QlixSDK. Construct QlixSDK() before calling "
                    "a @qlix.tool-decorated function. See QLIX_AGENT_FILE."
                )

            bound = sig.bind(*args, **kwargs)
            bound.apply_defaults()
            payload: dict[str, Any] = dict(bound.arguments)

            return await sdk.run(
                action_type=scope,
                payload=payload,
                execute_fn=lambda: fn(*args, **kwargs),
                risk_level=risk,
            )

        wrapper._qlix_tool = meta  # type: ignore[attr-defined]
        return wrapper

    return decorator


def _sig_to_json_schema(sig: inspect.Signature) -> dict[str, Any]:
    """Convert a function signature into a JSON Schema ``properties`` dict."""
    props: dict[str, Any] = {}
    required: list[str] = []

    for name, param in sig.parameters.items():
        if name in ("self", "cls"):
            continue

        annotation = param.annotation
        json_type = (
            _PY_TO_JSON.get(annotation, "string")
            if annotation is not inspect.Parameter.empty
            else "string"
        )
        props[name] = {"type": json_type}

        if param.default is inspect.Parameter.empty:
            required.append(name)

    schema: dict[str, Any] = {"type": "object", "properties": props}
    if required:
        schema["required"] = required
    return schema


__all__ = ["ToolMeta", "tool"]
