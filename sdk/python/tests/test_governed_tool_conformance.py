import json
import time
import unittest
from dataclasses import dataclass

from qlix.identity import AgentIdentity
from qlix.luna.core.types import ToolCall, ToolResult
from qlix.luna.tools._stubs import BaseTool, ToolSpec
from qlix.luna_bridge import QlixToolExecutor
from qlix.sdk import QlixSDK


class FakeHttp:
    def __init__(self):
        self.posts = []

    async def post_json(self, path, body, **_kwargs):
        self.posts.append((path, body))
        return {"actionId": "00000000-0000-0000-0000-000000000001"} if path.endswith("/start") else {}

    async def aclose(self):
        return None


@dataclass
class Approval:
    jit_token: str = "jit-token-123"


class FakeJit:
    def __init__(self):
        self.requests = []

    async def request_and_wait(self, *, action_type, payload):
        self.requests.append((action_type, payload))
        return Approval()


class FixtureTool(BaseTool):
    def __init__(self, name="read_tool", *, success=True, delay=0.0, confirm=False):
        self._name = name
        self._success = success
        self._delay = delay
        self._confirm = confirm
        self.calls = []

    @property
    def spec(self):
        return ToolSpec(
            name=self._name,
            description="fixture",
            parameters={"type": "object"},
            requires_confirmation=self._confirm,
            timeout_seconds=0.01 if self._delay else 1.0,
        )

    def execute(self, **params):
        self.calls.append(params)
        if self._delay:
            time.sleep(self._delay)
        return ToolResult(
            tool_name=self._name,
            content="ok" if self._success else "reported failure",
            success=self._success,
        )


def identity(*scopes, jit=()):
    return AgentIdentity(
        did="did:qlix:test",
        agent_id="agent-test",
        private_key_hex="11" * 32,
        public_key_hex="22" * 32,
        permission_scopes=tuple(scopes),
        jit_scopes=tuple(jit),
        always_scopes=tuple(s for s in scopes if s not in jit),
        backend_url="http://test",
        llm_mode="proxy",
        raw={},
    )


class GovernedToolConformanceTests(unittest.TestCase):
    def make_executor(self, tool, ident):
        http = FakeHttp()
        sdk = QlixSDK(identity=ident, http=http)
        sdk._jit = FakeJit()
        executor = QlixToolExecutor(
            [tool], qlix=sdk, interactive=True, confirm_callback=lambda _prompt: True
        )
        return executor, sdk, http

    def test_read_only_success_is_started_executed_and_completed(self):
        tool = FixtureTool()
        executor, _sdk, http = self.make_executor(tool, identity("read_tool"))
        result = executor.execute(ToolCall(id="call-1", name="read_tool", arguments='{"q":"x"}'))
        self.assertTrue(result.success)
        self.assertEqual(tool.calls, [{"q": "x"}])
        self.assertEqual([path for path, _body in http.posts], [
            "/api/v1/actions/start", "/api/v1/actions/complete"
        ])
        self.assertTrue(http.posts[-1][1]["signedPayload"]["success"])
        self.assertEqual(
            http.posts[-1][1]["signedPayload"]["result"]["content_preview"], "ok"
        )

    def test_reported_failure_is_completed_as_failure_and_returned(self):
        tool = FixtureTool("write_tool", success=False)
        executor, _sdk, http = self.make_executor(tool, identity("write_tool"))
        result = executor.execute(ToolCall(id="call-2", name="write_tool", arguments="{}"))
        self.assertFalse(result.success)
        self.assertFalse(http.posts[-1][1]["signedPayload"]["success"])
        self.assertEqual(http.posts[-1][1]["signedPayload"]["errorCode"], "ToolReportedFailure")

    def test_signed_action_links_to_the_active_run(self):
        tool = FixtureTool()
        executor, sdk, http = self.make_executor(tool, identity("read_tool"))
        sdk.set_run_context(
            run_id="run-123",
            conversation_id="conversation-123",
            team_run_id="team-run-123",
        )
        result = executor.execute(ToolCall(id="call-linked", name="read_tool", arguments="{}"))
        self.assertTrue(result.success)
        self.assertEqual(
            http.posts[0][1]["signedPayload"]["metadata"]["_qlix"],
            {
                "runId": "run-123",
                "conversationId": "conversation-123",
                "teamRunId": "team-run-123",
            },
        )

    def test_jit_tool_gets_approval_before_start(self):
        tool = FixtureTool("mutate_tool", confirm=True)
        executor, sdk, http = self.make_executor(
            tool, identity("mutate_tool", jit=("mutate_tool",))
        )
        result = executor.execute(ToolCall(id="call-3", name="mutate_tool", arguments="{}"))
        self.assertTrue(result.success)
        self.assertEqual(sdk._jit.requests, [("mutate_tool", {})])
        self.assertEqual(http.posts[0][1]["signedPayload"]["jitToken"], "jit-token-123")

    def test_timeout_keeps_existing_tool_result_and_failure_completion(self):
        tool = FixtureTool("slow_tool", delay=0.03)
        executor, _sdk, http = self.make_executor(tool, identity("slow_tool"))
        result = executor.execute(ToolCall(id="call-4", name="slow_tool", arguments="{}"))
        self.assertFalse(result.success)
        self.assertIn("timed out", result.content)
        self.assertFalse(http.posts[-1][1]["signedPayload"]["success"])


if __name__ == "__main__":
    unittest.main()
