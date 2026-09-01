import asyncio
import unittest

from qlix.governed_execution import (
    ExecutionStage,
    ExecutionTrace,
    GovernedExecutionPipeline,
    ResultValidation,
)


class GovernedExecutionPipelineTests(unittest.TestCase):
    def test_success_uses_the_complete_order(self):
        trace = ExecutionTrace()
        completed = []

        async def run():
            return await GovernedExecutionPipeline[str]().run(
                resolve=lambda: "provider",
                validate=lambda _provider: None,
                authorize=lambda _provider: None,
                approve=lambda _provider: "approval",
                pre_log=lambda _provider, _approval: "action-1",
                execute=lambda _provider: "ok",
                complete_success=lambda action, result: completed.append((action, result)),
                complete_failure=lambda *_args: self.fail("unexpected failure completion"),
                trace=trace,
            )

        self.assertEqual(asyncio.run(run()), "ok")
        self.assertEqual(completed, [("action-1", "ok")])
        self.assertEqual(trace.stages, list(ExecutionStage))

    def test_reported_failure_is_logged_and_returned(self):
        completed = []

        async def run():
            return await GovernedExecutionPipeline[str]().run(
                pre_log=lambda *_args: "action-2",
                execute=lambda _resolved: "provider failure",
                validate_result=lambda result: ResultValidation(
                    success=False, error_message=result, error_code="ReportedFailure"
                ),
                complete_success=lambda *_args: self.fail("unexpected success completion"),
                complete_failure=lambda action, exc, validation: completed.append(
                    (action, exc, validation.error_code)
                ),
            )

        self.assertEqual(asyncio.run(run()), "provider failure")
        self.assertEqual(completed, [("action-2", None, "ReportedFailure")])

    def test_authorization_failure_never_executes_or_logs(self):
        called = []

        async def run():
            return await GovernedExecutionPipeline[str]().run(
                authorize=lambda _resolved: (_ for _ in ()).throw(PermissionError("denied")),
                pre_log=lambda *_args: called.append("pre_log"),
                execute=lambda _resolved: called.append("execute"),
                complete_success=lambda *_args: None,
                complete_failure=lambda *_args: None,
            )

        with self.assertRaisesRegex(PermissionError, "denied"):
            asyncio.run(run())
        self.assertEqual(called, [])

    def test_execution_exception_is_logged_then_reraised(self):
        completed = []

        async def run():
            return await GovernedExecutionPipeline[str]().run(
                pre_log=lambda *_args: "action-3",
                execute=lambda _resolved: (_ for _ in ()).throw(TimeoutError("slow")),
                complete_success=lambda *_args: None,
                complete_failure=lambda action, exc, validation: completed.append(
                    (action, type(exc), validation)
                ),
            )

        with self.assertRaisesRegex(TimeoutError, "slow"):
            asyncio.run(run())
        self.assertEqual(completed, [("action-3", TimeoutError, None)])


if __name__ == "__main__":
    unittest.main()
