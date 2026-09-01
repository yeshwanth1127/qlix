from __future__ import annotations

import json
import unittest
from pathlib import Path

from qlix.contracts import (
    CapabilityDescriptor,
    RunnerRequest,
    RunnerResponse,
    RuntimeEventEnvelope,
    TraceEnvelope,
    ContractVersionError,
    RUNNER_REQUEST_CONTRACT_VERSION,
    negotiate_contract_version,
    unwrap_runner_request,
    unwrap_runner_response,
    wrap_legacy_runner_request,
    wrap_legacy_runner_response,
)
from qlix.runner_common import extract_polled_run, runner_completion_body


REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE = REPO_ROOT / "contracts/agent-runtime/fixtures/capability-descriptor.v1.json"
EVENT_FIXTURE = REPO_ROOT / "contracts/agent-runtime/fixtures/runtime-event.v1.json"
REQUEST_FIXTURE = REPO_ROOT / "contracts/agent-runtime/fixtures/runner-request.v1.json"
RESPONSE_FIXTURE = REPO_ROOT / "contracts/agent-runtime/fixtures/runner-response.v1.json"
TRACE_FIXTURE = REPO_ROOT / "contracts/telemetry/fixtures/trace-envelope.v1.json"


class RuntimeContractTests(unittest.TestCase):
    def test_capability_fixture_round_trips_without_wire_changes(self) -> None:
        wire = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(CapabilityDescriptor.from_wire(wire).to_wire(), wire)

    def test_unknown_capability_contract_version_fails_loudly(self) -> None:
        wire = json.loads(FIXTURE.read_text(encoding="utf-8"))
        wire["contractVersion"] = "qlix.capability.v999"
        with self.assertRaisesRegex(ValueError, "Unsupported capability contract version"):
            CapabilityDescriptor.from_wire(wire)

    def test_runtime_event_fixture_round_trips_without_wire_changes(self) -> None:
        wire = json.loads(EVENT_FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(RuntimeEventEnvelope.from_wire(wire).to_wire(), wire)

    def test_unknown_runtime_event_contract_version_fails_loudly(self) -> None:
        wire = json.loads(EVENT_FIXTURE.read_text(encoding="utf-8"))
        wire["contractVersion"] = "qlix.runtime-event.v999"
        with self.assertRaisesRegex(ValueError, "Unsupported runtime event contract version"):
            RuntimeEventEnvelope.from_wire(wire)

    def test_runner_contract_fixtures_round_trip_without_wire_changes(self) -> None:
        request = json.loads(REQUEST_FIXTURE.read_text(encoding="utf-8"))
        response = json.loads(RESPONSE_FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(RunnerRequest.from_wire(request).to_wire(), request)
        self.assertEqual(RunnerResponse.from_wire(response).to_wire(), response)

    def test_legacy_runner_payload_adapters_are_lossless(self) -> None:
        request_wire = json.loads(REQUEST_FIXTURE.read_text(encoding="utf-8"))
        response_wire = json.loads(RESPONSE_FIXTURE.read_text(encoding="utf-8"))
        wrapped_request = wrap_legacy_runner_request(
            agent_id=request_wire["agentId"], runtime=request_wire["runtime"], payload=request_wire["payload"]
        )
        self.assertEqual(unwrap_runner_request(wrapped_request), request_wire["payload"])
        legacy_response = {key: value for key, value in response_wire.items() if key not in {"contractVersion", "runId"}}
        wrapped_response = wrap_legacy_runner_response(run_id=response_wire["runId"], payload=legacy_response)
        self.assertEqual(unwrap_runner_response(wrapped_response), legacy_response)

    def test_contract_negotiation_keeps_legacy_and_fails_loudly(self) -> None:
        self.assertIsNone(negotiate_contract_version(None, [RUNNER_REQUEST_CONTRACT_VERSION]))
        self.assertEqual(
            negotiate_contract_version(["future.v2", RUNNER_REQUEST_CONTRACT_VERSION], [RUNNER_REQUEST_CONTRACT_VERSION]),
            RUNNER_REQUEST_CONTRACT_VERSION,
        )
        with self.assertRaisesRegex(ContractVersionError, "No compatible contract version"):
            negotiate_contract_version(["future.v2"], [RUNNER_REQUEST_CONTRACT_VERSION])

    def test_live_runner_boundary_prefers_contract_and_preserves_legacy(self) -> None:
        payload = {"id": "run-live", "prompt": "hello", "custom": {"kept": True}}
        wrapped = wrap_legacy_runner_request(
            agent_id="agent-live", runtime="hybrid", payload=payload
        ).to_wire()
        self.assertEqual(
            extract_polled_run(
                {"runnerRequest": wrapped, "run": {"id": "wrong"}},
                agent_id="agent-live",
                runtime="hybrid",
            ),
            payload,
        )
        self.assertEqual(
            extract_polled_run(
                {"run": payload}, agent_id="agent-live", runtime="hybrid"
            ),
            payload,
        )

    def test_live_completion_boundary_emits_versioned_response(self) -> None:
        body = runner_completion_body(
            run_id="run-live", ok=False, result="partial", error_message="failed"
        )
        self.assertEqual(body["contractVersion"], "qlix.runner-response.v1")
        self.assertEqual(body["runId"], "run-live")
        self.assertEqual(body["result"], "partial")
        self.assertEqual(body["errorMessage"], "failed")

    def test_trace_envelope_fixture_round_trips_without_wire_changes(self) -> None:
        wire = json.loads(TRACE_FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(TraceEnvelope.from_wire(wire).to_wire(), wire)


if __name__ == "__main__":
    unittest.main()
