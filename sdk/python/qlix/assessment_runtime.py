"""Hybrid runner: assessment.* tools via the Qlix backend's assessment tool proxy.

Mirrors cloud_email_runtime.py's shape (scope-gated tool defs + backend_url/
runner_token-bound executors) rather than the local-filesystem BaseTool pattern
in luna/tools/, since every one of these tools reads/writes Qlix-hosted
assessment state rather than the local machine.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from .identity import AgentIdentity

ASSESSMENT_TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "assessment_context_get": (
        "assessment.session.get",
        "assessment.framework.read",
        "assessment.evidence.search",
        "assessment.evidence.read",
    ),
    "assessment_session_get": ("assessment.session.get",),
    "assessment_framework_read": ("assessment.framework.read",),
    "assessment_evidence_search": ("assessment.evidence.search",),
    "assessment_reference_list": ("assessment.evidence.search",),
    "assessment_reference_batch_read": ("assessment.evidence.read",),
    "assessment_evidence_read": ("assessment.evidence.read",),
    "assessment_artifact_read": ("assessment.artifact.read",),
    "assessment_snapshot_read": ("assessment.snapshot.read",),
    "assessment_snapshot_compare": ("assessment.snapshot.compare",),
    "assessment_record": ("assessment.record",),
    "assessment_review_ask": ("assessment.review.ask",),
    "assessment_review_request_demonstration": ("assessment.review.request_demonstration",),
    "assessment_report_create": ("assessment.report.create",),
}

ASSESSMENT_TOOL_DEFINITIONS: dict[str, dict[str, Any]] = {
    "assessment_context_get": {
        "type": "function",
        "function": {
            "name": "assessment_context_get",
            "description": (
                "Get one normalized, role-scoped assessment context pack: session brief, "
                "owned criteria, relevant evidence references, snapshots, and shared findings. "
                "Call once per dispatch."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id from the Team goal."},
                },
                "required": ["sessionId"],
            },
        },
    },
    "assessment_session_get": {
        "type": "function",
        "function": {
            "name": "assessment_session_get",
            "description": "Read the Work Session under assessment: status, recipe, and metadata.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                },
                "required": ["sessionId"],
            },
        },
    },
    "assessment_framework_read": {
        "type": "function",
        "function": {
            "name": "assessment_framework_read",
            "description": "Read the evaluation framework (checklist/rubric criteria) assigned to a Work Session.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                },
                "required": ["sessionId"],
            },
        },
    },
    "assessment_evidence_search": {
        "type": "function",
        "function": {
            "name": "assessment_evidence_search",
            "description": "Search the evidence timeline collected for a Work Session, optionally filtered by kind.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "file_snapshot",
                            "git_event",
                            "terminal_event",
                            "test_result",
                            "build_result",
                            "lint_result",
                            "ai_prompt",
                            "artifact_upload",
                            "manual_note",
                        ],
                        "description": "Optional exact evidence kind filter. Use artifact_upload for uploaded artifacts.",
                    },
                    "limit": {"type": "integer", "description": "Max records to return (default 50)."},
                },
                "required": ["sessionId"],
            },
        },
    },
    "assessment_reference_list": {
        "type": "function",
        "function": {
            "name": "assessment_reference_list",
            "description": "List compact evidence references and short previews. Use this once instead of loading full evidence records.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string"},
                    "kinds": {"type": "array", "items": {"type": "string"}, "maxItems": 9},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                },
                "required": ["sessionId"],
            },
        },
    },
    "assessment_reference_batch_read": {
        "type": "function",
        "function": {
            "name": "assessment_reference_batch_read",
            "description": "Read up to 25 selected evidence references in one bounded call. Use one batch, not repeated single reads.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string"},
                    "referenceIds": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 25},
                    "maxCharsPerReference": {"type": "integer", "minimum": 500, "maximum": 8000},
                },
                "required": ["sessionId", "referenceIds"],
            },
        },
    },
    "assessment_record": {
        "type": "function",
        "function": {
            "name": "assessment_record",
            "description": (
                "Record multiple criterion findings for a Work Session in one call. Send every finding "
                "this examiner owns as one batch. Repeating a criterion from this same agent replaces "
                "its earlier finding. Use verdict='needs_review' when evidence is unclear."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "findings": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 100,
                        "items": {
                            "type": "object",
                            "properties": {
                                "criterionId": {"type": "string"},
                                "verdict": {
                                    "type": "string",
                                    "enum": ["met", "partially_met", "not_met", "unclear", "needs_review"],
                                },
                                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                                "evidenceRefs": {
                                    "type": "array",
                                    "items": {"type": "string", "minLength": 1},
                                    "minItems": 1,
                                    "description": "Real evidence ids returned by assessment reference tools.",
                                },
                                "rationale": {"type": "string"},
                            },
                            "required": ["criterionId", "verdict", "confidence", "evidenceRefs", "rationale"],
                        },
                    },
                },
                "required": ["sessionId", "findings"],
            },
        },
    },
    "assessment_review_ask": {
        "type": "function",
        "function": {
            "name": "assessment_review_ask",
            "description": (
                "Ask the assessment subject one defense-interview question grounded in their actual work. "
                "Fire-and-forget: this does not wait for the answer itself — the Team pipeline pauses "
                "automatically between stages until the subject answers, then the next stage receives the "
                "exchange as context. Do not call a 'wait' tool; there isn't one."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "criterionId": {"type": "string", "description": "Criterion this question clarifies."},
                    "questionId": {"type": "string", "description": "Stable id for this question (e.g. 'q1')."},
                    "questionText": {"type": "string", "description": "The question to ask, in plain language."},
                },
                "required": ["sessionId", "criterionId", "questionId", "questionText"],
            },
        },
    },
    "assessment_evidence_read": {
        "type": "function",
        "function": {
            "name": "assessment_evidence_read",
            "description": "Read one evidence record by id (from assessment_evidence_search results).",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "evidenceId": {"type": "string", "description": "Evidence record id."},
                },
                "required": ["sessionId", "evidenceId"],
            },
        },
    },
    "assessment_artifact_read": {
        "type": "function",
        "function": {
            "name": "assessment_artifact_read",
            "description": (
                "Read the content behind an evidence record — inline payload for small structured "
                "evidence, or the stored file's text (truncated) for larger artifacts like file "
                "snapshots or test/build output. Binary content returns metadata only, not bytes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "evidenceId": {"type": "string", "description": "Evidence record id whose content to read."},
                },
                "required": ["sessionId", "evidenceId"],
            },
        },
    },
    "assessment_snapshot_read": {
        "type": "function",
        "function": {
            "name": "assessment_snapshot_read",
            "description": "Read a project snapshot (folder structure, file hashes) by label, or the latest if omitted.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "label": {"type": "string", "description": "e.g. 'start' | 'submission' | 'pre_demo' | 'post_demo' | 'completion'."},
                },
                "required": ["sessionId"],
            },
        },
    },
    "assessment_snapshot_compare": {
        "type": "function",
        "function": {
            "name": "assessment_snapshot_compare",
            "description": "Diff two project snapshots by label; returns added/removed/changed file paths.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "labelA": {"type": "string", "description": "Earlier snapshot label."},
                    "labelB": {"type": "string", "description": "Later snapshot label."},
                },
                "required": ["sessionId", "labelA", "labelB"],
            },
        },
    },
    "assessment_review_request_demonstration": {
        "type": "function",
        "function": {
            "name": "assessment_review_request_demonstration",
            "description": (
                "Ask the assessment subject to make a small live change and demonstrate understanding — "
                "more consequential than a text question, so this requires human approval before it runs. "
                "Fire-and-forget like assessment_review_ask; the Team pipeline pauses until they respond."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "criterionId": {"type": "string", "description": "Criterion this demonstration clarifies."},
                    "questionId": {"type": "string", "description": "Stable id for this exchange (e.g. 'demo1')."},
                    "instructions": {"type": "string", "description": "What to change and demonstrate, in plain language."},
                },
                "required": ["sessionId", "criterionId", "questionId", "instructions"],
            },
        },
    },
    "assessment_report_create": {
        "type": "function",
        "function": {
            "name": "assessment_report_create",
            "description": (
                "Create the final evidence-backed readiness report for a Work Session from its "
                "assessment record findings. Requires human approval before it runs, and the created "
                "report is still only a draft — a human reviewer must separately confirm or override it "
                "before it is final. Never a substitute for that human confirmation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sessionId": {"type": "string", "description": "Work Session id."},
                    "assessmentRecordId": {"type": "string", "description": "AssessmentRecord id this report summarizes."},
                    "summary": {"type": "string", "description": "Evidence-backed readiness summary for the human reviewer."},
                },
                "required": ["sessionId", "assessmentRecordId", "summary"],
            },
        },
    },
}


def _effective_granted_scopes(identity: AgentIdentity) -> set[str]:
    return set(identity.permission_scopes) | set(identity.always_scopes)


def openai_assessment_tool_definitions(
    identity: AgentIdentity,
    skill_filter: list[str] | None,
) -> list[dict[str, Any]]:
    """Return OpenAI tool defs for assessment tools allowed by scopes + skill filter."""
    granted = _effective_granted_scopes(identity)
    tool_ids = list(ASSESSMENT_TOOL_SCOPES.keys())

    if skill_filter:
        filt = {str(s).strip() for s in skill_filter if str(s).strip()}
        if any("." in s for s in filt):
            tool_ids = [t for t in tool_ids if any(s in filt for s in ASSESSMENT_TOOL_SCOPES.get(t, ()))]
        else:
            tool_ids = [t for t in tool_ids if t in filt]

    # The compact index and bounded batch reader supersede the legacy full search
    # and single-record reader. Keep legacy definitions for rolling compatibility,
    # but do not offer both paths to a model in the same assessment run.
    if "assessment_reference_list" in tool_ids:
        tool_ids = [t for t in tool_ids if t != "assessment_evidence_search"]
    if "assessment_reference_batch_read" in tool_ids:
        tool_ids = [t for t in tool_ids if t != "assessment_evidence_read"]
    if "assessment_context_get" in tool_ids:
        superseded = {
            "assessment_session_get",
            "assessment_framework_read",
            "assessment_evidence_search",
            "assessment_evidence_read",
            "assessment_reference_list",
            "assessment_reference_batch_read",
            "assessment_snapshot_read",
            "assessment_snapshot_compare",
        }
        tool_ids = [t for t in tool_ids if t not in superseded]

    out: list[dict[str, Any]] = []
    for tid in tool_ids:
        req = ASSESSMENT_TOOL_SCOPES.get(tid, ())
        if any(s not in granted for s in req):
            continue
        defn = ASSESSMENT_TOOL_DEFINITIONS.get(tid)
        if defn:
            out.append(defn)
    return out


def _post_assessment_tool(
    *,
    backend_url: str,
    runner_token: str,
    agent_id: str,
    path: str,
    body: dict[str, Any],
) -> str:
    url = f"{backend_url.rstrip('/')}{path}"
    headers = {"X-QLIX-Runner-Token": runner_token, "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, headers=headers, json=body)
    except Exception as exc:
        return f"[failed] Assessment tool request error: {exc}"

    text = resp.text
    try:
        data = resp.json() if text else {}
    except json.JSONDecodeError:
        data = {"raw": text[:4000]}

    if resp.status_code >= 400:
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            return f"[failed] {err.get('code', 'error')}: {err.get('message', text[:500])}"
        return f"[failed] HTTP {resp.status_code}: {text[:500]}"

    return json.dumps(data, ensure_ascii=False)


def build_assessment_tool_executors(
    *,
    identity: AgentIdentity,
    skill_filter: list[str] | None,
    agent_id: str,
    run_id: str,
    backend_url: str,
    runner_token: str,
) -> dict[str, callable]:
    """Pre-bind assessment tool executors for the inference loop."""
    executors: dict[str, callable] = {}
    defs = openai_assessment_tool_definitions(identity, skill_filter)
    allowed = {d["function"]["name"] for d in defs if isinstance(d.get("function"), dict)}

    def _call(path: str, body: dict[str, Any]) -> str:
        return _post_assessment_tool(
            backend_url=backend_url,
            runner_token=runner_token,
            agent_id=agent_id,
            path=f"/api/v1/agents/{agent_id}/tools/assessment/{path}",
            body={"runId": run_id, **body},
        )

    if "assessment_context_get" in allowed:

        def _context_get(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call("context-get", {"sessionId": params.get("sessionId", "")})

        executors["assessment_context_get"] = _context_get

    if "assessment_session_get" in allowed:

        def _session_get(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call("session-get", {"sessionId": params.get("sessionId", "")})

        executors["assessment_session_get"] = _session_get

    if "assessment_framework_read" in allowed:

        def _framework_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call("framework-read", {"sessionId": params.get("sessionId", "")})

        executors["assessment_framework_read"] = _framework_read

    if "assessment_evidence_search" in allowed:

        def _evidence_search(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {"sessionId": params.get("sessionId", "")}
            if params.get("kind"):
                body["kind"] = params["kind"]
            if params.get("limit") is not None:
                body["limit"] = params["limit"]
            return _call("evidence-search", body)

        executors["assessment_evidence_search"] = _evidence_search

    if "assessment_reference_list" in allowed:

        def _reference_list(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {"sessionId": params.get("sessionId", "")}
            if isinstance(params.get("kinds"), list):
                body["kinds"] = params["kinds"]
            if params.get("limit") is not None:
                body["limit"] = params["limit"]
            return _call("reference-list", body)

        executors["assessment_reference_list"] = _reference_list

    if "assessment_reference_batch_read" in allowed:

        def _reference_batch_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {
                "sessionId": params.get("sessionId", ""),
                "referenceIds": params.get("referenceIds") or [],
            }
            if params.get("maxCharsPerReference") is not None:
                body["maxCharsPerReference"] = params["maxCharsPerReference"]
            return _call("reference-batch-read", body)

        executors["assessment_reference_batch_read"] = _reference_batch_read

    if "assessment_record" in allowed:

        def _record(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            findings = params.get("findings")
            if not isinstance(findings, list):
                # Backward-compatible execution for an older cached schema/tool call.
                findings = [
                    {
                        "criterionId": params.get("criterionId", ""),
                        "verdict": params.get("verdict", ""),
                        "confidence": params.get("confidence", 0),
                        "evidenceRefs": params.get("evidenceRefs") or [],
                        "rationale": params.get("rationale", ""),
                    }
                ]
            missing_refs = [
                str(finding.get("criterionId") or f"finding #{index + 1}")
                for index, finding in enumerate(findings)
                if not isinstance(finding, dict)
                or not any(str(ref).strip() for ref in (finding.get("evidenceRefs") or []))
            ]
            if missing_refs:
                return (
                    "[failed] assessment_record requires at least one real evidenceRefs id "
                    "for every finding. Add ids returned by assessment_reference_list or "
                    "assessment_reference_batch_read. Missing: " + ", ".join(missing_refs)
                )
            return _call(
                "record",
                {
                    "sessionId": params.get("sessionId", ""),
                    "findings": findings,
                },
            )

        executors["assessment_record"] = _record

    if "assessment_review_ask" in allowed:

        def _review_ask(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call(
                "review-ask",
                {
                    "sessionId": params.get("sessionId", ""),
                    "criterionId": params.get("criterionId", ""),
                    "questionId": params.get("questionId", ""),
                    "questionText": params.get("questionText", ""),
                },
            )

        executors["assessment_review_ask"] = _review_ask

    if "assessment_evidence_read" in allowed:

        def _evidence_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call("evidence-read", {"sessionId": params.get("sessionId", ""), "evidenceId": params.get("evidenceId", "")})

        executors["assessment_evidence_read"] = _evidence_read

    if "assessment_artifact_read" in allowed:

        def _artifact_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call("artifact-read", {"sessionId": params.get("sessionId", ""), "evidenceId": params.get("evidenceId", "")})

        executors["assessment_artifact_read"] = _artifact_read

    if "assessment_snapshot_read" in allowed:

        def _snapshot_read(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            body: dict[str, Any] = {"sessionId": params.get("sessionId", "")}
            if params.get("label"):
                body["label"] = params["label"]
            return _call("snapshot-read", body)

        executors["assessment_snapshot_read"] = _snapshot_read

    if "assessment_snapshot_compare" in allowed:

        def _snapshot_compare(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call(
                "snapshot-compare",
                {
                    "sessionId": params.get("sessionId", ""),
                    "labelA": params.get("labelA", ""),
                    "labelB": params.get("labelB", ""),
                },
            )

        executors["assessment_snapshot_compare"] = _snapshot_compare

    if "assessment_review_request_demonstration" in allowed:

        def _review_request_demonstration(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call(
                "review-request-demonstration",
                {
                    "sessionId": params.get("sessionId", ""),
                    "criterionId": params.get("criterionId", ""),
                    "questionId": params.get("questionId", ""),
                    "instructions": params.get("instructions", ""),
                },
            )

        executors["assessment_review_request_demonstration"] = _review_request_demonstration

    if "assessment_report_create" in allowed:

        def _report_create(args_json: str) -> str:
            params = json.loads(args_json) if args_json.strip() else {}
            return _call(
                "report-create",
                {
                    "sessionId": params.get("sessionId", ""),
                    "assessmentRecordId": params.get("assessmentRecordId", ""),
                    "summary": params.get("summary", ""),
                },
            )

        executors["assessment_report_create"] = _report_create

    # Reserved runner hooks are not exposed as model tools. Assessment agents get a
    # strict loop budget, while all other runtimes retain their configured budget.
    # Three turns remain the normal path. The runner reserves turn four as a
    # recovery-only finalization turn and forces assessment_record on it.
    executors["_qlix_max_rounds"] = lambda: 3
    required_terminal = (
        "assessment_report_create"
        if "assessment_report_create" in allowed
        else ""
        if "assessment_review_ask" in allowed
        else "assessment_record"
    )
    executors["_qlix_required_terminal_tool"] = lambda: required_terminal
    executors["_qlix_disable_budget_subagent"] = lambda: True

    def _terminal_result(executed: list[dict[str, str]]) -> str | None:
        """Turn a successful batched record call into the final Result envelope.

        This removes the otherwise redundant fourth inference whose only job is to
        restate data the model already supplied to assessment_record.
        """
        def _refs(value: Any) -> set[str]:
            found: set[str] = set()
            if isinstance(value, dict):
                for key, nested in value.items():
                    if key in {"evidenceRefs", "evidence_refs"} and isinstance(nested, list):
                        found.update(str(ref) for ref in nested if str(ref).strip())
                    else:
                        found.update(_refs(nested))
            elif isinstance(value, list):
                for nested in value:
                    found.update(_refs(nested))
            return found

        context_evidence_refs: set[str] = set()
        for row in executed:
            if row.get("name") != "assessment_context_get":
                continue
            try:
                context_evidence_refs.update(_refs(json.loads(row.get("output") or "{}")))
            except (json.JSONDecodeError, TypeError):
                pass

        for item in reversed(executed):
            terminal_name = str(item.get("name") or "")
            if terminal_name not in {"assessment_record", "assessment_review_ask", "assessment_report_create"} or item.get("output", "").startswith("[failed] "):
                continue
            try:
                args = json.loads(item.get("args") or "{}")
            except json.JSONDecodeError:
                return None
            findings = args.get("findings")
            if terminal_name == "assessment_record" and (not isinstance(findings, list) or not findings):
                return None
            evidence_refs = sorted(context_evidence_refs | _refs(args))
            if not evidence_refs:
                return None
            if terminal_name == "assessment_record":
                summary = f"Recorded {len(findings)} evidence-backed finding(s)."
                result_findings: Any = findings
            elif terminal_name == "assessment_review_ask":
                summary = "Queued an evidence-grounded defense question."
                result_findings = {"question": args}
            else:
                summary = "Created the draft assessment report for human review."
                result_findings = {"report": args}
            return json.dumps({
                "summary": summary,
                "findings": result_findings,
                "provenance": {
                    "toolRefs": sorted({str(row.get("name")) for row in executed if row.get("name")}),
                    "evidenceRefs": evidence_refs,
                    "artifactRefs": [],
                },
            }, ensure_ascii=False)
        return None

    executors["_qlix_terminal_result_builder"] = _terminal_result
    return executors


def is_assessment_tool(tool_name: str) -> bool:
    return tool_name in ASSESSMENT_TOOL_DEFINITIONS
