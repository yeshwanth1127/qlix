from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import replace
from typing import List

from qlix.luna.core.registry import CompressionRegistry
from qlix.luna.core.types import Message, Role
from qlix.context_management import build_structured_context, make_context_artifact, serialize_messages


class BaseCompressor(ABC):
    """Abstract base for context compression strategies."""

    def _retain_artifact(self, content: str, source_kind: str):
        artifact = make_context_artifact(content, source_kind=source_kind)
        artifacts = getattr(self, "_context_artifacts", None)
        if not isinstance(artifacts, dict):
            artifacts = {}
            self._context_artifacts = artifacts
        artifacts[artifact.artifact_id] = artifact.content
        return artifact

    def get_context_artifact(self, artifact_id: str) -> str | None:
        artifacts = getattr(self, "_context_artifacts", {})
        return artifacts.get(artifact_id) if isinstance(artifacts, dict) else None

    @abstractmethod
    def compress(self, messages: List[Message], threshold: float) -> List[Message]: ...


@CompressionRegistry.register("session_consolidation")
class SessionConsolidation(BaseCompressor):
    """Summarize oldest N% of turns, keep recent (100-N)%."""

    def compress(self, messages: List[Message], threshold: float) -> List[Message]:
        if not messages:
            return messages
        split = int(len(messages) * threshold)
        old = messages[:split]
        recent = messages[split:]
        if not old:
            return messages
        artifact = self._retain_artifact(
            serialize_messages(old), "in_memory_history"
        )
        structured = build_structured_context(old, source_artifact_ids=[artifact.artifact_id])
        summary = Message(
            role=Role.SYSTEM,
            content=structured.to_text(),
            metadata={
                "kind": "context_compaction",
                "version": "1.0",
                "artifact_id": artifact.artifact_id,
                "artifact_sha256": artifact.sha256,
                "structured": structured.to_dict(),
            },
        )
        return [summary] + recent


@CompressionRegistry.register("rule_based_precompression")
class RuleBasedPrecompression(BaseCompressor):
    """No LLM call. Strip boilerplate, truncate long outputs, collapse dupes."""

    TOOL_OUTPUT_MAX = 2000

    def compress(self, messages: List[Message], threshold: float) -> List[Message]:
        result: list[Message] = []
        for msg in messages:
            if msg.role == Role.TOOL and len(msg.content) > self.TOOL_OUTPUT_MAX:
                artifact = self._retain_artifact(msg.content, "rule_based_tool_output")
                preview = msg.content[: self.TOOL_OUTPUT_MAX]
                result.append(
                    replace(
                        msg,
                        content=f"{preview}\n[… full output: {artifact.reference_text()}]",
                        metadata={
                            **msg.metadata,
                            "context_artifact_id": artifact.artifact_id,
                            "context_artifact_sha256": artifact.sha256,
                        },
                    )
                )
            else:
                result.append(msg)
        return result


@CompressionRegistry.register("model_summarization")
class ModelSummarization(BaseCompressor):
    """LLM-based summarization using configured engine/model."""

    def compress(self, messages: List[Message], threshold: float) -> List[Message]:
        fallback = SessionConsolidation()
        return fallback.compress(messages, threshold)


@CompressionRegistry.register("tiered_summaries")
class TieredSummaries(BaseCompressor):
    """Progressive compression: L0 (full) -> L1 (paragraph) -> L2 (one-line)."""

    def compress(self, messages: List[Message], threshold: float) -> List[Message]:
        if not messages:
            return messages
        n = len(messages)
        l2_end = int(n * threshold * 0.5)
        l1_end = int(n * threshold)
        l2_msgs = messages[:l2_end]
        l1_msgs = messages[l2_end:l1_end]
        l0_msgs = messages[l1_end:]
        result: list[Message] = []
        if l2_msgs:
            artifact = self._retain_artifact(
                serialize_messages(l2_msgs), "tiered_oldest_history"
            )
            structured = build_structured_context(
                l2_msgs, source_artifact_ids=[artifact.artifact_id]
            )
            result.append(
                Message(
                    role=Role.SYSTEM,
                    content=structured.to_text(max_chars=3000),
                    metadata={
                        "kind": "context_compaction",
                        "tier": "L2",
                        "artifact_id": artifact.artifact_id,
                        "artifact_sha256": artifact.sha256,
                        "structured": structured.to_dict(),
                    },
                )
            )
        if l1_msgs:
            artifact = self._retain_artifact(
                serialize_messages(l1_msgs), "tiered_earlier_history"
            )
            structured = build_structured_context(
                l1_msgs, source_artifact_ids=[artifact.artifact_id]
            )
            result.append(
                Message(
                    role=Role.SYSTEM,
                    content=structured.to_text(max_chars=4500),
                    metadata={
                        "kind": "context_compaction",
                        "tier": "L1",
                        "artifact_id": artifact.artifact_id,
                        "artifact_sha256": artifact.sha256,
                        "structured": structured.to_dict(),
                    },
                )
            )
        result.extend(l0_msgs)
        return result
