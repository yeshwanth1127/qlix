"""Provider-neutral ordered lifecycle for governed tool execution."""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Generic, TypeVar


T = TypeVar("T")
MaybeAsync = Callable[..., Any | Awaitable[Any]]


class ExecutionStage(str, Enum):
    RESOLVE = "resolve"
    VALIDATE = "validate"
    AUTHORIZE = "authorize"
    APPROVE = "approve"
    PRE_LOG = "pre_log"
    EXECUTE = "execute"
    VALIDATE_RESULT = "validate_result"
    COMPLETE_LOG = "complete_log"
    BILL = "bill"
    EMIT = "emit"


@dataclass(slots=True)
class ResultValidation:
    success: bool = True
    error_message: str | None = None
    error_code: str | None = None
    completion_result: Any = None


@dataclass(slots=True)
class ExecutionTrace:
    """Non-sensitive stage trace for conformance tests and diagnostics."""

    stages: list[ExecutionStage] = field(default_factory=list)


async def _call(callback: MaybeAsync | None, *args: Any) -> Any:
    if callback is None:
        return None
    value = callback(*args)
    return await value if inspect.isawaitable(value) else value


class GovernedExecutionPipeline(Generic[T]):
    """Run a tool through the same ordered governance stages.

    Provider adapters keep control of their public result and error types. The
    pipeline only owns ordering: failures before execute never invoke the tool;
    execution exceptions are completion-logged and then re-raised; reported
    failures are completion-logged and returned unchanged.
    """

    async def run(
        self,
        *,
        resolve: MaybeAsync | None = None,
        validate: MaybeAsync | None = None,
        authorize: MaybeAsync | None = None,
        approve: MaybeAsync | None = None,
        pre_log: MaybeAsync,
        execute: MaybeAsync,
        validate_result: Callable[[T], ResultValidation] | None = None,
        complete_success: MaybeAsync,
        complete_failure: MaybeAsync,
        bill: MaybeAsync | None = None,
        emit: MaybeAsync | None = None,
        trace: ExecutionTrace | None = None,
    ) -> T:
        observed = trace or ExecutionTrace()

        async def stage(name: ExecutionStage, callback: MaybeAsync | None, *args: Any) -> Any:
            observed.stages.append(name)
            return await _call(callback, *args)

        resolved = await stage(ExecutionStage.RESOLVE, resolve)
        await stage(ExecutionStage.VALIDATE, validate, resolved)
        await stage(ExecutionStage.AUTHORIZE, authorize, resolved)
        approval = await stage(ExecutionStage.APPROVE, approve, resolved)
        action = await stage(ExecutionStage.PRE_LOG, pre_log, resolved, approval)

        try:
            result = await stage(ExecutionStage.EXECUTE, execute, resolved)
        except BaseException as exc:
            await stage(ExecutionStage.COMPLETE_LOG, complete_failure, action, exc, None)
            await stage(ExecutionStage.BILL, bill, action, False)
            await stage(ExecutionStage.EMIT, emit, action, None, exc)
            raise

        validation = await stage(
            ExecutionStage.VALIDATE_RESULT,
            validate_result or (lambda _result: ResultValidation()),
            result,
        )
        if not isinstance(validation, ResultValidation):
            raise TypeError("validate_result must return ResultValidation")

        if validation.success:
            completion_result = (
                validation.completion_result
                if validation.completion_result is not None
                else result
            )
            await stage(
                ExecutionStage.COMPLETE_LOG,
                complete_success,
                action,
                completion_result,
            )
        else:
            await stage(ExecutionStage.COMPLETE_LOG, complete_failure, action, None, validation)
        await stage(ExecutionStage.BILL, bill, action, validation.success)
        await stage(ExecutionStage.EMIT, emit, action, result, None)
        return result


__all__ = [
    "ExecutionStage",
    "ExecutionTrace",
    "GovernedExecutionPipeline",
    "ResultValidation",
]
