import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from qlix.context_management import (
    build_structured_context,
    load_context_source_catalog,
    make_context_artifact,
)
from qlix.luna.sessions.compression import RuleBasedPrecompression, SessionConsolidation
from qlix.luna.sessions.session import SessionStore
from qlix.luna.core.types import Message, Role
from qlix.luna.core.events import EventBus, EventType
from qlix.runner import AgentRunner
from qlix.runner_common import compact_history, context_compaction_event_data


class ContextManagementTests(unittest.TestCase):
    def test_catalog_has_deterministic_order_and_budgets(self):
        catalog = load_context_source_catalog()
        sources = {source["id"]: source for source in catalog["sources"]}
        self.assertEqual(set(catalog["ordering"]), set(sources))
        self.assertEqual(len(catalog["ordering"]), len(set(catalog["ordering"])))
        self.assertTrue(all(source["budgetTokens"] > 0 for source in sources.values()))
        self.assertEqual(sources["current_task"]["trust"], "authoritative")
        self.assertGreater(sources["current_task"]["priority"], sources["tool_calls"]["priority"])

    def test_structured_context_preserves_load_bearing_fields(self):
        messages = [
            {"role": "user", "content": "Build the report. Do not remove existing features."},
            {"role": "assistant", "content": "Decision: use the existing runner contract."},
            {"role": "user", "content": "Approved. Continue; the remaining task is upload."},
            {"role": "tool", "content": "Created /tmp/report.pdf artifactId=artifact-12345"},
        ]
        context = build_structured_context(messages)
        rendered = context.to_text()
        self.assertIn("Build the report", rendered)
        self.assertIn("Do not remove existing features", rendered)
        self.assertIn("Decision: use the existing runner contract", rendered)
        self.assertIn("Approved", rendered)
        self.assertIn("remaining task is upload", rendered)
        self.assertTrue(any("report.pdf" in ref for ref in context.artifacts))

    def test_tool_spill_keeps_hash_and_durable_references_without_inline_payload(self):
        original = "https://example.com/source\n" + "S" * 9000
        messages = [{"role": "tool", "content": original}]
        artifacts = compact_history(
            messages,
            keep_tool_msgs=0,
            keep_arg_calls=0,
            clear_result_over=100,
            clear_args_over=100,
        )
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0].content, original)
        self.assertIn(artifacts[0].artifact_id, messages[0]["content"])
        self.assertIn("https://example.com/source", messages[0]["content"])
        self.assertNotIn("S" * 100, messages[0]["content"])
        event = context_compaction_event_data(artifacts)
        self.assertEqual(event["message"], "context_compacted")
        self.assertNotIn("content", event["artifacts"][0])
        self.assertEqual(event["artifacts"][0]["artifactId"], artifacts[0].artifact_id)

    def test_session_consolidation_keeps_full_artifact_and_structured_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = SessionStore(
                Path(temp_dir) / "sessions.db",
                consolidation_threshold=8,
            )
            session = store.get_or_create("person")
            history = [
                ("user", "Build Project Atlas."),
                ("user", "Approved; continue the remaining upload step."),
                ("user", "You must preserve all existing records."),
                ("assistant", "Decision: use CSV output. Artifact: /tmp/atlas.csv. Upload is pending."),
                ("user", "Keep the customer IDs unchanged."),
                ("assistant", "The report is ready."),
                ("user", "Keep the customer IDs unchanged."),
                ("assistant", "Acknowledged."),
                ("user", "What remains?"),
            ]
            for role, content in history:
                store.save_message(session.session_id, role, content)

            loaded = store.get_or_create("person")
            summaries = [m for m in loaded.messages if m.metadata.get("kind") == "context_compaction"]
            self.assertEqual(len(summaries), 1)
            summary = summaries[0]
            self.assertIn("Build Project Atlas", summary.content)
            self.assertIn("preserve all existing records", summary.content)
            self.assertIn("Approved", summary.content)
            self.assertIn("Upload is pending", summary.content)
            artifact_id = summary.metadata["source_artifact_ids"][-1]
            artifact = store.get_context_artifact(artifact_id)
            self.assertIsNotNone(artifact)
            transcript = json.loads(artifact["content"])
            self.assertEqual([row["content"] for row in transcript], [c for _, c in history[:4]])
            store.close()

    def test_legacy_compressor_preserves_requirements_in_structured_form(self):
        messages = [
            Message(role=Role.USER, content="Create the launch plan."),
            Message(role=Role.USER, content="Do not change the approved budget."),
            Message(role=Role.ASSISTANT, content="The remaining task is legal review."),
            Message(role=Role.USER, content="continue"),
        ]
        compressor = SessionConsolidation()
        compacted = compressor.compress(messages, 0.75)
        self.assertEqual(compacted[0].metadata["kind"], "context_compaction")
        self.assertIn("Do not change the approved budget", compacted[0].content)
        self.assertIn("remaining task is legal review", compacted[0].content)
        artifact_id = compacted[0].metadata["artifact_id"]
        self.assertIn("Create the launch plan", compressor.get_context_artifact(artifact_id))

    def test_rule_based_tool_compaction_retains_full_private_artifact(self):
        compressor = RuleBasedPrecompression()
        original = "result " + "r" * 4000
        compacted = compressor.compress([Message(role=Role.TOOL, content=original)], 0.5)
        artifact_id = compacted[0].metadata["context_artifact_id"]
        self.assertEqual(compressor.get_context_artifact(artifact_id), original)
        self.assertNotIn("r" * 3000, compacted[0].content)

    def test_agent_runner_long_history_keeps_private_artifact_and_emits_event(self):
        runner = object.__new__(AgentRunner)
        bus = EventBus(record_history=True)
        runner._system = SimpleNamespace(bus=bus)
        runner._context_artifacts = {}
        runner._history = [
            Message(role=Role.USER, content="Build Atlas. Do not remove exports. " + "x" * 700),
            Message(role=Role.ASSISTANT, content="Decision: keep the current API. " + "y" * 700),
            Message(role=Role.USER, content="Approved; remaining work is deployment. " + "z" * 700),
            *[
                Message(role=Role.ASSISTANT, content=f"older detail {i} " + "d" * 700)
                for i in range(10)
            ],
            *[Message(role=Role.USER, content=f"recent {i}") for i in range(4)],
        ]
        with patch.dict(
            "os.environ",
            {"QLIX_LOCAL_HISTORY_MAX_CHARS": "8000", "QLIX_LOCAL_HISTORY_KEEP_MESSAGES": "4"},
        ):
            runner._compact_history_if_needed()
        self.assertEqual(len(runner._history), 5)
        summary = runner._history[0]
        self.assertIn("Do not remove exports", summary.content)
        self.assertIn("Approved", summary.content)
        artifact_id = summary.metadata["source_artifact_ids"][-1]
        self.assertIn("Build Atlas", runner.get_context_artifact(artifact_id))
        events = [event for event in bus.history if event.event_type == EventType.CONTEXT_COMPACTED]
        self.assertEqual(len(events), 1)
        self.assertNotIn("content", events[0].data)


if __name__ == "__main__":
    unittest.main()
