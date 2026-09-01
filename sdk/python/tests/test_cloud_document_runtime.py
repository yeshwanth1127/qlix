"""Tests for cloud document tools (PDF + spreadsheet)."""

from __future__ import annotations

import json

from qlix.cloud_document_runtime import build_document_tool_executors, openai_document_tool_definitions
from qlix.identity import AgentIdentity


def _identity(**kwargs: object) -> AgentIdentity:
    base = {
        "did": "did:t:1",
        "agent_id": "a1",
        "private_key_hex": "0" * 64,
        "public_key_hex": "1" * 64,
        "permission_scopes": ("files.create",),
        "jit_scopes": (),
        "always_scopes": (),
        "backend_url": "http://localhost",
        "llm_mode": "proxy",
        "raw": {},
    }
    base.update(kwargs)
    return AgentIdentity(
        did=str(base["did"]),
        agent_id=str(base["agent_id"]),
        private_key_hex=str(base["private_key_hex"]),
        public_key_hex=str(base["public_key_hex"]),
        permission_scopes=tuple(base["permission_scopes"]),  # type: ignore[arg-type]
        jit_scopes=tuple(base["jit_scopes"]),  # type: ignore[arg-type]
        always_scopes=tuple(base["always_scopes"]),  # type: ignore[arg-type]
        backend_url=str(base["backend_url"]),
        llm_mode=str(base["llm_mode"]),
        raw=dict(base["raw"]),  # type: ignore[arg-type]
    )


def test_document_tools_offered_with_files_create_scope() -> None:
    defs = openai_document_tool_definitions(_identity(permission_scopes=("files.create",)), None)
    names = {d["function"]["name"] for d in defs}
    assert "create_report_pdf" in names
    assert "create_xlsx" in names


def test_document_tools_not_offered_with_research_alone() -> None:
    defs = openai_document_tool_definitions(_identity(permission_scopes=("web.research",)), None)
    names = {d["function"]["name"] for d in defs}
    assert "create_report_pdf" not in names
    assert "create_xlsx" not in names


def test_create_xlsx_executor_writes_spreadsheet(monkeypatch) -> None:
    uploaded: dict[str, str] = {}

    def fake_upload(path, *, agent_id, run_id, backend_url, runner_token, content_type):
        uploaded["content_type"] = content_type
        uploaded["name"] = path.name
        return "https://example.com/api/v1/sandbox/abc123"

    monkeypatch.setattr("qlix.cloud_document_runtime._upload_sandbox_file", fake_upload)

    executors = build_document_tool_executors(
        identity=_identity(),
        skill_filter=None,
        agent_id="a1",
        run_id="r1",
        backend_url="http://localhost:4000",
        runner_token="tok",
    )
    create_xlsx = executors["create_xlsx"]
    result = create_xlsx(
        json.dumps(
            {
                "title": "Sales Report",
                "rows": [["Product", "Qty"], ["Widget", 5]],
            }
        )
    )
    assert "[failed]" not in result
    assert "Shareable download link" in result
    assert "https://example.com/api/v1/sandbox/abc123" in result
    assert uploaded["content_type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert uploaded["name"].endswith(".xlsx")
