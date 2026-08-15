from qlix.luna_teams import (
    ConversationSignalRequest,
    ConversationStartRequest,
    ConversationStatus,
    ConversationWorkflow,
    as_payload,
)


def test_conversation_contracts_are_provider_neutral_payloads():
    workflow = ConversationWorkflow(
        key="qualification",
        entry_node_id="ask",
        nodes=(
            {"id": "ask", "type": "ask", "content": "Interested?", "variable": "interest", "next": "done"},
            {"id": "done", "type": "complete"},
        ),
    )
    start = ConversationStartRequest(
        owner_type="team",
        workflow_key=workflow.key,
        channel="whatsapp",
        participants=({"role": "contact", "address": "+911234567890"},),
    )
    signal = ConversationSignalRequest(
        thread_id="thread_1",
        signal={"type": "inbound", "text": "yes"},
        idempotency_key="provider-message-1",
    )

    assert as_payload(workflow)["entry_node_id"] == "ask"
    assert as_payload(start)["participants"][0]["role"] == "contact"
    assert as_payload(signal)["signal"]["type"] == "inbound"
    assert ConversationStatus.WAITING_INPUT.value == "waiting_input"

