export type TeamRunFailureCode =
  | "missing_attachment"
  | "missing_input_reference"
  | "team_runners_not_ready"
  | "email_connector_required"
  | "invalid_continues_run"
  | "worker_timeout"
  | "worker_no_result"
  | "worker_validation_failed"
  | "worker_run_failed"
  | "stage_aborted"
  | "run_canceled"
  | "run_stalled"
  | "upload_error"
  | "gateway_rejected"
  | "pipeline_error";

export interface TeamRunFailure {
  code: TeamRunFailureCode | string;
  title: string;
  message: string;
  reason?: string;
  hint?: string;
  stage?: string;
  agentName?: string;
}

export interface TeamRunApiErrorBody {
  code?: string;
  message?: string;
  title?: string;
  reason?: string;
  hint?: string;
}

export class TeamRunRequestError extends Error {
  readonly code: string;
  readonly title: string;
  readonly reason?: string;
  readonly hint?: string;
  readonly failure: TeamRunFailure;

  constructor(failure: TeamRunFailure) {
    super(failure.message);
    this.name = "TeamRunRequestError";
    this.code = failure.code;
    this.title = failure.title;
    this.reason = failure.reason;
    this.hint = failure.hint;
    this.failure = failure;
  }
}

function isTeamRunFailure(value: unknown): value is TeamRunFailure {
  if (!value || typeof value !== "object") return false;
  const record = value as TeamRunFailure;
  return (
    typeof record.code === "string" &&
    typeof record.title === "string" &&
    typeof record.message === "string"
  );
}

export function parseTeamRunFailurePayload(payload: unknown): TeamRunFailure | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const raw = record.failure ?? record.failureJson;
  return isTeamRunFailure(raw) ? raw : null;
}

export function teamRunFailureFromApiError(
  error: TeamRunApiErrorBody | null | undefined,
  fallbackMessage = "Request failed",
): TeamRunFailure {
  if (!error) {
    return {
      code: "pipeline_error",
      title: "Request failed",
      message: fallbackMessage,
    };
  }
  return {
    code: error.code ?? "pipeline_error",
    title: error.title ?? "Request failed",
    message: error.message ?? fallbackMessage,
    ...(error.reason ? { reason: error.reason } : {}),
    ...(error.hint ? { hint: error.hint } : {}),
  };
}

export function teamRunFailureFromMessage(message: string): TeamRunFailure {
  const text = message.trim();
  if (/no file was uploaded|missing_attachment|spreadsheet not attached/i.test(text)) {
    return {
      code: "missing_attachment",
      title: "Spreadsheet not attached",
      message: text,
      reason:
        "Team runs do not read lead lists from Brain. Attach the Excel file to the run itself.",
      hint: "Use the paperclip in the composer, attach your spreadsheet, then send again.",
    };
  }
  if (/no valid input reference|no uploaded spreadsheet/i.test(text)) {
    return {
      code: "missing_input_reference",
      title: "Spreadsheet not attached to this run",
      message: text,
      reason: "This run has no authoritative_input file for the first stage.",
      hint: "Attach the Excel file or continue the previous run that already included it.",
    };
  }
  if (/Pipeline aborted/i.test(text)) {
    const stageMatch = text.match(/stage "([^"]+)"/i);
    return {
      code: "stage_aborted",
      title: stageMatch?.[1] ? `Stage "${stageMatch[1]}" failed` : "Pipeline stage failed",
      message: text,
      reason: "A worker stage failed and downstream stages were skipped.",
      hint: "Fix the failed stage, then retry or start a new run.",
      ...(stageMatch?.[1] ? { agentName: stageMatch[1], stage: stageMatch[1] } : {}),
    };
  }
  return {
    code: "pipeline_error",
    title: "Team run failed",
    message: text || "The team run failed.",
  };
}

export function resolveTeamRunFailureFromRun(
  run: { status?: string; errorMessage?: string | null },
  events: Array<{ eventType: string; payload: unknown }> = [],
): TeamRunFailure | null {
  if (run.status !== "failed") return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.eventType !== "run_failed") continue;
    const parsed = parseTeamRunFailurePayload(event.payload);
    if (parsed) return parsed;
  }
  if (run.errorMessage?.trim()) {
    return teamRunFailureFromMessage(run.errorMessage);
  }
  return null;
}
