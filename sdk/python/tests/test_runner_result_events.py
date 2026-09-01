import asyncio
import os
import unittest
from unittest.mock import patch

from qlix.governed_execution import ExecutionStage, ExecutionTrace
from qlix.runner_common import (
    emit_event,
    emit_inference_result_events,
    execute_runner_tool,
    replay_input_manifest,
    run_backend_proxy_inference,
)
from qlix.backend_inference_client import BackendInferenceResult
from qlix.identity import AgentIdentity
from qlix.exceptions import HttpError


class FakeHttp:
    def __init__(self):
        self.posts = []

    async def post_json(self, path, body, **kwargs):
        self.posts.append((path, body, kwargs))
        return {}


class ConflictingHttp(FakeHttp):
    def __init__(self, conflicts):
        super().__init__()
        self.conflicts = conflicts

    async def post_json(self, path, body, **kwargs):
        self.posts.append((path, body, kwargs))
        if self.conflicts > 0:
            self.conflicts -= 1
            raise HttpError("event_seq_conflict", status_code=409)
        return {}


class RunnerResultEventTests(unittest.TestCase):
    def test_event_sequence_conflicts_retry_without_aborting_work(self):
        http = ConflictingHttp(conflicts=2)

        async def run():
            return await emit_event(
                http,
                agent_id="agent",
                run_id="run",
                headers={},
                seq=7,
                event_type="log",
                data={"message": "tool_started"},
            )

        self.assertEqual(asyncio.run(run()), 8)
        self.assertEqual(len(http.posts), 3)

    def test_persistent_event_sequence_conflict_is_non_fatal_telemetry(self):
        http = ConflictingHttp(conflicts=10)

        async def run():
            return await emit_event(
                http,
                agent_id="agent",
                run_id="run",
                headers={},
                seq=11,
                event_type="log",
                data={"message": "tool_started"},
            )

        self.assertEqual(asyncio.run(run()), 12)
        self.assertEqual(len(http.posts), 5)

    def test_replay_manifest_records_inputs_without_prompt_contents(self):
        manifest = replay_input_manifest(
            [{"role": "user", "content": "password=do-not-store"}],
            [
                {
                    "type": "function",
                    "function": {
                        "name": "web_search",
                        "description": "search",
                        "parameters": {"type": "object"},
                    },
                }
            ],
        )
        rendered = str(manifest)
        self.assertNotIn("do-not-store", rendered)
        self.assertEqual(manifest["messages"][0]["role"], "user")
        self.assertEqual(manifest["tools"][0]["name"], "web_search")
        self.assertEqual(len(manifest["messages"][0]["sha256"]), 64)

    def test_all_bound_provider_types_use_governed_stage_order(self):
        http = FakeHttp()
        trace = ExecutionTrace()

        async def connector_executor(args):
            return f"connector:{args}"

        async def run():
            return await execute_runner_tool(
                http=http,
                agent_id="agent",
                run_id="run",
                headers={},
                seq=10,
                name="connector_read",
                args='{"id":1}',
                tool_executors={"connector_read": connector_executor},
                trace=trace,
            )

        seq, output = asyncio.run(run())
        self.assertEqual(seq, 11)
        self.assertEqual(output, 'connector:{"id":1}')
        self.assertEqual(trace.stages, list(ExecutionStage))
        self.assertEqual(http.posts[0][1]["data"], {
            "message": "tool_started", "tool": "connector_read"
        })

    def test_provider_exception_keeps_existing_failed_string(self):
        http = FakeHttp()

        def failing(_args):
            raise TimeoutError("slow")

        async def run():
            return await execute_runner_tool(
                http=http,
                agent_id="agent",
                run_id="run",
                headers={},
                seq=0,
                name="mcp.server.tool",
                args="{}",
                tool_executors={"mcp.server.tool": failing},
            )

        _seq, output = asyncio.run(run())
        self.assertEqual(output, "[failed] mcp.server.tool raised: slow")

    def test_shared_transcript_preserves_cloud_provider_field(self):
        http = FakeHttp()

        async def run():
            return await emit_inference_result_events(
                http,
                agent_id="agent",
                run_id="run",
                headers={"x": "y"},
                seq=4,
                model="model",
                provider=None,
                usage={"total_tokens": 7},
                tool_calls=["web_search"],
                content="hello world",
                turns=2,
            )

        with patch.dict(os.environ, {"QLIX_DELTA_WORDS_PER_CHUNK": "25"}):
            final_seq = asyncio.run(run())
        self.assertEqual(final_seq, 7)
        payloads = [body for _path, body, _kwargs in http.posts]
        self.assertEqual(payloads[0]["data"]["message"], "inference_success")
        self.assertIn("provider", payloads[0]["data"])
        self.assertIsNone(payloads[0]["data"]["provider"])
        self.assertEqual(payloads[1]["type"], "delta")
        self.assertEqual(payloads[2]["data"], {
            "message": "run_result", "turns": 2, "tool_calls": ["web_search"]
        })

    def test_hybrid_transcript_omits_provider_field(self):
        http = FakeHttp()

        async def run():
            return await emit_inference_result_events(
                http,
                agent_id="agent",
                run_id="run",
                headers={},
                seq=0,
                model="model",
                usage={},
                tool_calls=[],
                content="ok",
                turns=1,
            )

        asyncio.run(run())
        self.assertNotIn("provider", http.posts[0][1]["data"])

    def test_final_round_forces_required_terminal_tool_after_validation_failure(self):
        http = FakeHttp()
        choices = []
        responses = [
            BackendInferenceResult(
                content="",
                finish_reason="tool_calls",
                usage={},
                provider=None,
                tool_calls=[{
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "assessment_record", "arguments": '{"evidenceRefs":[]}'},
                }],
            ),
            BackendInferenceResult(
                content="",
                finish_reason="tool_calls",
                usage={},
                provider=None,
                tool_calls=[{
                    "id": "call-2",
                    "type": "function",
                    "function": {"name": "assessment_record", "arguments": '{"evidenceRefs":["e1"]}'},
                }],
            ),
        ]

        async def fake_completion(*_args, **kwargs):
            choices.append(kwargs.get("tool_choice"))
            return responses.pop(0)

        def record(args):
            return "[failed] missing evidence" if '"evidenceRefs":[]' in args else '{"recorded":1}'

        def terminal(executed):
            if any(item["name"] == "assessment_record" and not item["output"].startswith("[failed]") for item in executed):
                return '{"summary":"Recorded","findings":[],"provenance":{"toolRefs":["assessment_record"],"evidenceRefs":["e1"],"artifactRefs":[]}}'
            return None

        identity = AgentIdentity(
            did="did:qlix:test",
            agent_id="agent",
            private_key_hex="00" * 32,
            public_key_hex="11" * 32,
            permission_scopes=(),
            jit_scopes=(),
            always_scopes=(),
            backend_url="http://localhost",
            llm_mode="proxy",
            raw={},
        )

        async def run():
            with patch("qlix.runner_common.backend_proxy_chat_completion", fake_completion), patch(
                "qlix.runner_common.assert_run_not_canceled", return_value=[]
            ):
                return await run_backend_proxy_inference(
                    http,
                    identity=identity,
                    agent_id="agent",
                    headers={},
                    seq=0,
                    run_id="run",
                    model="model",
                    enriched_prompt="Assess session s1",
                    tools=[{"type": "function", "function": {"name": "assessment_record", "parameters": {"type": "object"}}}],
                    tool_executors={
                        "assessment_record": record,
                        "_qlix_required_terminal_tool": lambda: "assessment_record",
                        "_qlix_terminal_result_builder": terminal,
                    },
                    tools_hash="hash",
                    tools_schema_bytes=100,
                    log=lambda *_args, **_kwargs: None,
                    max_rounds=2,
                )

        result = asyncio.run(run())
        self.assertEqual(choices[0], "auto")
        self.assertEqual(choices[1], {"type": "function", "function": {"name": "assessment_record"}})
        self.assertIn('"summary":"Recorded"', result[1])


if __name__ == "__main__":
    unittest.main()
